# Prompt-caching optimization (backend LLM passes)

> **Status: partially implemented (2026-07-05).** Done: item 1 (per-pass cache-usage logging), item 2 (grade rubric moved into the system prefix), item 4 (second breakpoint in `buildMethodologySystem`), the stale nominate comment fix, plus a model refresh that superseded part of item 3 — `MODEL_SONNET` is now **Sonnet 5** (`claude-sonnet-5`), and `verify-exercise` + `nominate-candidates` moved from Opus to Sonnet 5 (env-overridable: `EXERCISE_VERIFY_MODEL`, `NOMINATE_MODEL`) — both now clear the (assumed 2,048-token) Sonnet minimum and cache. Sonnet 5 runs adaptive thinking when `thinking` is omitted, so every Sonnet call site passes an explicit `thinking: {type: 'disabled'}`. Still open: item 3 for the passes remaining on Opus (`generate-exercise` 2,883, `generate-practice-text` 3,213, card chat ~3k — all still below Opus's 4,096 minimum), item 5 (TTL tuning, waiting on item-1 prod data), item 6's chat-history breakpoint. Post-change measurements (2026-07-05): basic-data 4,891 (Sonnet 5) ✓, enrichment 5,777 (Opus) ✓, nominate 2,614 (Sonnet 5) ✓, verify 2,328 (Sonnet 5) ✓, grade 2,706 (Sonnet 5) ✓. Caveat: Sonnet 5's minimum cacheable prefix is assumed equal to Sonnet 4.6's 2,048 — confirm with the cache-usage log lines (`cache_read_input_tokens > 0` on repeat calls).

## Context

Anthropic Console emailed "Your prompt cache hit rate is low — caching could save up to 24% of API spend". Audit of every backend Anthropic call site found the cause: the `cache_control` breakpoints exist and are correctly placed, but most Opus calls have a prefix **below the model's minimum cacheable length**, so the marker silently does nothing (no error — the response just reports `cache_creation_input_tokens: 0`).

## Facts the plan relies on

- Prompt caching is a **prefix match** over the rendered request. Render order: `tools` → `system` → `messages`. A breakpoint on the last system block caches tools + system together. Different tool schemas (each pass has its own) therefore split the cache per pass — expected, not a bug.
- **Minimum cacheable prefix** (cumulative, up to the breakpoint): Opus 4.8/4.7/4.6/4.5 and Haiku 4.5 → **4096 tokens**; Sonnet 4.6 → **2048 tokens**. Below the minimum the breakpoint is silently ignored.
- Pricing: cache reads ≈ 0.1× base input; writes 1.25× (5-min TTL, default) or 2× (`ttl: "1h"`). 5-min TTL breaks even at 2 requests; 1-h TTL needs ≥3.
- Max **4** breakpoints per request; we currently use 1.
- A cache entry becomes readable only once the first response starts streaming — N truly parallel identical-prefix calls all pay full price.
- Verification: `response.usage.cache_creation_input_tokens` / `cache_read_input_tokens`. `input_tokens` is the *uncached remainder only*; total prompt = sum of all three.

## Current state (file map)

- `apps/backend/src/transport/third-party/anthropic/anthropic-client.ts` — models: `MODEL_OPUS = 'claude-opus-4-7'`, `MODEL_SONNET = 'claude-sonnet-4-6'`, `MODEL_HAIKU = 'claude-haiku-4-5-20251001'`, `MODEL_ENRICHMENT = process.env.ENRICHMENT_MODEL ?? MODEL_SONNET`.
- `apps/backend/src/transport/third-party/anthropic/methodology-prompt.ts` — the two system builders, each with a single `cache_control: { type: 'ephemeral' }` breakpoint on the **last** block:
  - `buildMethodologySystem` (session path): preamble → language instructions → user profile → translation mode → **context blob (breakpoint)**.
  - `buildPracticeMethodologySystem` (practice path): preamble → language instructions → translation mode → **user profile (breakpoint)**.
- Passes in `apps/backend/src/transport/third-party/anthropic/passes/`; per-card chat in `apps/backend/src/service/chat/run-card-chat.ts` (uses `buildPromptContext` → `buildMethodologySystem`).
- `apps/backend/src/service/processing/enrich-highlight.ts` passes `model: MODEL_ENRICHMENT` to `basicDataPass`; `apps/backend/src/service/adhoc/create-adhoc-card.ts` uses the pass default (`MODEL_OPUS`).
- **No code anywhere reads the `usage` cache fields** — zero observability today.

## Measured prefix sizes (2026-07-05, Russian target = largest language block; other languages are smaller)

Method: intercept `fetch`, invoke the real pass functions with dummy args to capture the exact request bodies, count `tools + system` via the API `count_tokens` endpoint (user message replaced with `'x'`). Script in the appendix.

| Pass | Model in prod | Prefix (tools+system) | Minimum | Caches today? |
|---|---|---|---|---|
| basic-data (per-highlight enrichment) | Sonnet 4.6 | 5,217 | 2,048 | yes |
| enrichment-pass (full exploration) | Opus 4.7 | 5,777 | 4,096 | yes |
| nominate-candidates (ghost windows) | Opus 4.7 | 2,940 | 4,096 | **never** |
| generate-exercise (mc_cloze) | Opus 4.7 | 2,883 | 4,096 | **never** |
| verify-exercise | Opus 4.7 | 2,654 | 4,096 | **never** |
| grade-use-in-sentence | Sonnet 4.6 | **2,019** | 2,048 | **never — 29 tokens short** |
| generate-practice-text | Opus 4.7 | 3,213 | 4,096 | **never** |
| card chat (estimated, not measured) | Opus 4.7 | ~3,000 | 4,096 | never |
| fast-gloss / language-detection | Haiku 4.5 | ~76 | 4,096 | never (inherently tiny — leave alone) |

Notes:

- The non-caching group is the high-fan-out path: each exercise slot runs up to 3 Opus generate + 3–6 Opus verify calls (`MAX_GEN_ATTEMPTS = 3`), plus hint pre-warms and bank refills. ~85–90% of each call's input is the static prefix, so caching them cuts input cost on those calls by roughly 80%.
- `basicDataPass` for adhoc cards runs on Opus (pass default) — still caches (5,217 > 4,096). Adhoc sessions have a hardcoded stable `context_blob`, so the prefix is stable per user.
- The nominate pass's comment ("Reuses the cached methodology system prefix so successive windows hit the prompt cache") is currently **false** on Opus 4.7 — fix the comment or the fact.

## Work items (ordered)

Scope agreed 2026-07-05: implement items 1, 2, and 4 now. Item 3 is blocked on a per-pass decision from the user (present the a/b/c tradeoffs, let them choose). Item 5 waits for item 1's production data.

### 1. Cache observability (do first)

Add a small helper in `apps/backend/src/transport/third-party/anthropic/` that logs, per pass: pass name, model, `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`. Call it from every pass after `stream.finalMessage()` / `messages.create()` resolves (usage lives on the final message for streaming calls too). Purpose: confirm these findings in prod and verify each later fix actually lands. Keep it a plain logger line — no metrics infra.

### 2. `grade-use-in-sentence`: clear the Sonnet minimum (free win)

`apps/backend/src/transport/third-party/anthropic/passes/grade-use-in-sentence-pass.ts` is 29 tokens under 2,048. Move the static grading rubric text (the "Grade it. The bar: …" / "Sense handling: …" paragraphs currently rebuilt into every user message) into an extra system block appended after `buildPracticeMethodologySystem(...)` — with the breakpoint moved onto it (breakpoint must stay on the *last* stable block). Keeps only the dynamic term/sentence in the user message. Clears the minimum and shrinks the uncached tail.

### 3. The Opus practice passes: each ~1.1–1.4k tokens below 4,096 (decision needed)

Affected: `generate-exercise-pass.ts`, `verify-exercise-pass.ts`, `generate-practice-text.ts`, `nominate-candidates-pass.ts`, card chat. Options per pass — the user wants tradeoffs laid out, then decides:

- **(a) Grow the stable prefix with genuinely useful static content.** Move the static "Hard rules" / selection-criteria / checks text out of the per-call user messages into system blocks (same technique as item 2), then add real static guidance (e.g. per-language distractor-writing examples for the exercise pipeline — plausibly quality-positive for the generate/verify loop). Needs ~1k+ tokens of *real* content to clear 4,096; pure padding works economically (break-even at 2 calls per TTL window) but is ugly and fragile.
- **(b) Move the pass to Sonnet.** Sonnet's minimum is 2,048, so every one of these prompts caches *unchanged*, and Sonnet input/output is 40% of Opus's price on top. Quality tradeoff — SPEC.md says the exercise pipeline is accuracy-first ("cost is explicitly not a constraint"). Verify-exercise and nominate-candidates are the most plausible candidates; use an env-var override per pass (the existing `ENRICHMENT_MODEL` pattern in `anthropic-client.ts`) so it's A/B-able.
- **(c) Accept no caching** for low-volume passes (card chat is the obvious one).

Dynamic-content rule when moving text into system blocks: anything that varies per call (the random `TEXT_FORMATS` pick in `generate-practice-text.ts`, term data, rejection feedback) must stay in the user message, *after* the breakpoint.

### 4. Second breakpoint in `buildMethodologySystem`

Add `cache_control` to the translation-mode block (keeping the existing one on the context blob) in `methodology-prompt.ts`. Effect: a new session in the same target language re-reads the methodology + language-instructions + profile + mode prefix (~4,900 tokens on the session path — above both minimums) instead of paying a full cache write; only the ~300-token context blob is written fresh. Costs nothing (2 of 4 breakpoints used).

### 5. TTL tuning (only after item 1 produces data)

Practice-text generation and exercise refills are paced by the user (often >5 min apart), so a caching prefix can still miss on expiry. `ttl: "1h"` costs 2× on writes and pays off at ≥3 reads — flip it only where logs show expiry misses, not minimum-length misses.

### 6. Minor / optional

- Card chat multi-turn: each turn re-sends the seed turn (card render + surrounding segments) + history at full price. A message-level breakpoint on the last message would cache incrementally — but chat volume is low and the Opus minimum applies; only worth it combined with item 3.
- Parallel bank warm-ups with the same prefix all pay full price (entry readable only after the first response starts streaming). Mostly unavoidable; don't misread multiple cache writes per prefix as a bug.
- Fix the stale "hit the prompt cache" comment in `nominate-candidates-pass.ts` if the pass stays uncached.

## Verification

- Re-run the appendix script after each change; confirm the prefix column clears the model's minimum.
- With item 1 logging deployed, confirm `cache_read_input_tokens > 0` on second-and-later calls of each fixed pass, and watch the Console cost dashboard trend.
- `pnpm check:types` + affected unit tests (`basic-data-pass.unit.test.ts`, `generate-exercise-pass.unit.test.ts`, etc. — moving text between system/user blocks must not break the parsing helpers they test).

## Appendix: measurement script

Run from `apps/backend`: `NODE_ENV=development-tunnel doppler run -- npx tsx <path-to-script>.ts`. Uses the real backend key from Doppler; makes only `count_tokens` calls (free-tier metering, no generation).

```ts
// Measures the cacheable-prefix size (tools + system) of each backend LLM pass
// against the model it actually runs on. Works by intercepting fetch, invoking
// the real pass functions with dummy args to capture the exact request bodies,
// then counting tokens via the real count_tokens endpoint.
//
// Thresholds (minimum cacheable prefix): Opus 4.7 / Haiku 4.5 = 4096 tokens,
// Sonnet 4.6 = 2048 tokens. A prefix under the minimum silently never caches.

const captured: Array<{ label: string; body: any }> = []
let currentLabel = ''

const realFetch = globalThis.fetch
// Intercept: record the request body, return a 400 so the pass throws fast.
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(typeof input === 'string' ? input : (input?.url ?? input))
  if (url.includes('/v1/messages') && !url.includes('count_tokens')) {
    try {
      captured.push({ label: currentLabel, body: JSON.parse(init?.body ?? '{}') })
    } catch {
      /* ignore */
    }
    return new Response(
      JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'capture-only' } }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    )
  }
  return realFetch(input, init)
}) as typeof fetch

const BACKEND = '/Users/sebastien/Documents/flicktionary/apps/backend/src'

const FAKE_BLOB =
  'Topic: contemporary drama series set in Moscow; register conversational; tone ironic; recurring vocabulary themes: family conflict, money, bureaucracy; recurring characters: Dima, Olya, the landlord.'

const capture = async (label: string, fn: () => Promise<unknown>) => {
  currentLabel = label
  try {
    await fn()
  } catch {
    /* expected — capture-only fetch returns 400 */
  }
}

const run = async () => {
  const basic = await import(`${BACKEND}/transport/third-party/anthropic/passes/basic-data-pass`)
  const enrich = await import(`${BACKEND}/transport/third-party/anthropic/passes/enrichment-pass`)
  const nominate = await import(`${BACKEND}/transport/third-party/anthropic/passes/nominate-candidates-pass`)
  const genEx = await import(`${BACKEND}/transport/third-party/anthropic/passes/generate-exercise-pass`)
  const verifyEx = await import(`${BACKEND}/transport/third-party/anthropic/passes/verify-exercise-pass`)
  const grade = await import(`${BACKEND}/transport/third-party/anthropic/passes/grade-use-in-sentence-pass`)
  const genText = await import(`${BACKEND}/transport/third-party/anthropic/passes/generate-practice-text`)
  const fastGloss = await import(`${BACKEND}/transport/third-party/anthropic/passes/fast-gloss-pass`)

  await capture('basic-data (per-highlight enrichment)', () =>
    basic.basicDataPass({
      nativeLanguage: 'en',
      targetLanguage: 'ru',
      cefrLevel: 'B1',
      movieContextBlob: FAKE_BLOB,
      segments: [{ id: 's1', index: 0, text: 'Мы посмотрим, что будет дальше.' }],
      highlights: [{ highlightId: 'h1', segmentId: 's1', selectionText: 'посмотрим' }],
    })
  )

  await capture('enrichment-pass (full exploration)', () =>
    enrich.enrichmentPass({
      nativeLanguage: 'en',
      targetLanguage: 'ru',
      cefrLevel: 'B1',
      movieContextBlob: FAKE_BLOB,
      surfaceForm: 'посмотрим',
      surroundingSegments: '[s1] Мы посмотрим, что будет дальше.',
    })
  )

  await capture('nominate-candidates (ghost windows)', () =>
    nominate.nominateCandidatesPass({
      nativeLanguage: 'en',
      targetLanguage: 'ru',
      cefrLevel: 'B1',
      movieContextBlob: FAKE_BLOB,
      segments: [{ id: 's1', index: 0, text: 'Мы посмотрим, что будет дальше.' }],
    })
  )

  const term = {
    headword: 'посмотреть',
    sense: 'take a look',
    translation: 'to take a look',
    definition: null,
    targetExample: 'Мы посмотрим, что будет дальше.',
  }

  await capture('generate-exercise (mc_cloze)', () =>
    genEx.generateExercisePass({
      type: 'mc_cloze',
      term,
      targetLanguage: 'ru',
      nativeLanguage: 'en',
      cefrLevel: 'B1',
      hideTranslationFields: false,
      allowL1Notes: true,
    })
  )

  await capture('verify-exercise (mc_cloze)', () =>
    verifyEx.verifyExercisePass({
      exercise: {
        type: 'mc_cloze',
        payload: {
          sentence: 'Мы посмотрим, что будет дальше.',
          blankStart: 3,
          blankEnd: 12,
          answer: 'посмотрим',
          options: ['посмотрим', 'скажем', 'сделаем', 'возьмём'],
          answerIndex: 0,
        },
      },
      targetLanguage: 'ru',
      nativeLanguage: 'en',
      cefrLevel: 'B1',
      hideTranslationFields: false,
      allowL1Notes: true,
    })
  )

  await capture('grade-use-in-sentence', () =>
    grade.gradeUseInSentencePass({
      headword: 'посмотреть',
      sense: 'take a look',
      userSentence: 'Давай посмотрим фильм вечером.',
      targetLanguage: 'ru',
      nativeLanguage: 'en',
      cefrLevel: 'B1',
      hideTranslationFields: false,
      allowL1Notes: true,
    })
  )

  await capture('generate-practice-text', () =>
    genText.generatePracticeText({
      nativeLanguage: 'en',
      targetLanguage: 'ru',
      cefrLevel: 'B1',
      chunks: [{ ...term, nativeExample: null }],
    })
  )

  await capture('fast-gloss (tap-to-translate)', () =>
    fastGloss.fastGlossPass({
      targetLanguage: 'ru',
      nativeLanguage: 'en',
      contextLine: 'Мы посмотрим, что будет дальше.',
      selectionText: 'посмотрим',
    })
  )

  // Restore fetch and count each captured body via the real endpoint.
  globalThis.fetch = realFetch
  const { getAnthropicClient } = await import(`${BACKEND}/transport/third-party/anthropic/anthropic-client`)
  const client = getAnthropicClient()

  console.log(
    '\nlabel                                        model                   prefix(tools+system)  full-request'
  )
  for (const { label, body } of captured) {
    const base = {
      model: body.model,
      ...(body.system ? { system: body.system } : {}),
      ...(body.tools ? { tools: body.tools } : {}),
    }
    const prefixOnly = await client.messages.countTokens({
      ...base,
      messages: [{ role: 'user', content: 'x' }],
    } as any)
    const full = await client.messages.countTokens({
      ...base,
      messages: body.messages,
    } as any)
    const cc = JSON.stringify(body.system)?.includes('cache_control') ? 'breakpoint✓' : 'NO-breakpoint'
    console.log(
      `${label.padEnd(44)} ${String(body.model).padEnd(28)} ${String(prefixOnly.input_tokens).padStart(6)} ${String(full.input_tokens).padStart(12)}   ${cc}`
    )
  }
}

run().catch((e) => {
  console.error('FATAL', e?.message ?? e)
  process.exit(1)
})
```

Gotcha: the SDK binds `globalThis.fetch` at client construction, and the passes construct the singleton while the interceptor is active — that's why the interceptor must pass `count_tokens` URLs through instead of being "restored" later.
