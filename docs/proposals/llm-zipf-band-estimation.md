# LLM frequency-band (Zipf) estimation — validation test

> **Status: proposal — experiment run 2026-07-07, feature not implemented.**
> Test plan for validating that an LLM can estimate word/expression frequency
> bands well enough to order the new-term backlog. Nothing here is current
> behavior. The **Results** section below holds the experiment outcome:
> **go, LLM-only, continuous Zipf estimate, Opus.**

## Feature context (one paragraph)

Planned: a tiered priority system for introducing new terms. Today the new
bucket of `listReviewTerms` and warm-up parking discovery
(`listEligibleNewCitationFacets`) order by `created_at ASC` (FIFO — see
`docs/SRS.md` §4/4b). The plan is tiers: (1) lesson-error / multi-encounter
terms, (2) recent saves, (3) the rest ordered by a **frequency prior**. Corpus
frequency lists cover single words only; the user's vocabulary is full of
multi-word expressions ("цены не кусаются", "приём пищи") and inflected
idioms. Idea under test: the basic-data enrichment pass
(`apps/backend/src/transport/third-party/anthropic/passes/basic-data-pass.ts`)
emits one extra field — an estimated frequency band — at ~zero marginal cost,
working uniformly for words and expressions, any language. This experiment
measures whether those estimates are trustworthy, and at what granularity
(1–5 vs 1–10).

## Ground truth

The Python `wordfreq` package (`pip install wordfreq`) provides
`zipf_frequency(word, lang)` — a continuous Zipf scale (~0–8, where 7 ≈ "the",
2 ≈ genuinely rare) for `ru`, `de`, `es`, `en`, `fr` and others. It is the
ground truth for single words. Multi-word expressions have no corpus ground
truth — they get manual plausibility grading instead.

## Test sets

- **A. Stratified single words (ru, ~200):** sample across the Zipf range
  (e.g. 25 words per half-band from 1.5 to 6.5) using `wordfreq.top_n_list` at
  different ranks. Include some inflected forms (the model should judge the
  lexeme, not the surface form — worth checking).
- **B. Realistic vocabulary (ru, ~50):** words pulled from the user's actual
  lesson notes (untracked files at the repo root, e.g. `Sébastien.md`:
  перекупщик, дубляж, выговаривать, осваивать, ветряк, …). This is the
  distribution that matters in production.
- **C. Multi-word expressions (ru, ~30):** from the same notes ("цены не
  кусаются", "держаться на плаву", "внести залог", "приём пищи", "как можно
  больше"). No ground truth — graded by (a) manual plausibility ranking and
  (b) sanity vs the rarest-content-word heuristic
  (`min(zipf_frequency(w) for content words w)`).
- **D. Language generality (de or es, ~50):** repeat a small stratified set to
  check the approach isn't Russian-specific.

## Conditions

- **Scale:** band 1–5 vs 1–10 vs direct continuous Zipf estimate (0–8, one
  decimal). Hypothesis: coarse bands are all the tier system needs; finer
  scales only help if they're actually accurate.
- **Prompt shape:** (a) batched — many terms per call, cheap to test; (b)
  single term + a context sentence, mimicking how it would ride along in the
  basic-data pass. Check whether batching degrades accuracy and whether
  context shifts estimates (it shouldn't much; the lexeme is the target).
- **Model:** the enrichment model (Opus id in `anthropic-client.ts`) vs Haiku.
  If Haiku is close, a cheap backfill pass over the existing vocabulary
  becomes viable.
- **Stability:** re-run one condition 3× and measure variance (a prior that
  jitters between runs is fine for ordering only if the jitter is ≤ 1 band).

Standalone script (scratchpad or local uncommitted script); Anthropic key via
`doppler run --` from `apps/backend` scope; Python for `wordfreq` grading.

## Metrics and success criteria

| metric | target |
|---|---|
| Spearman correlation vs wordfreq (sets A, B, D) | ≥ 0.8 |
| ±1-band accuracy on the 1–5 scale (sets A, B) | ≥ 85% |
| MWE plausibility (set C, manual) | no gross inversions (a common idiom rated rarer than a rare word) |
| run-to-run variance | ≤ 1 band for ≥ 95% of terms |

## Decision rules the results feed

- **Scale:** if 1–10 is no more accurate than 1–5 (±1 accuracy scaled), use
  1–5.
- **LLM-only vs hybrid:** if the LLM matches wordfreq closely on single words,
  ship LLM-only (one mechanism, no vendored frequency tables — note the
  backend is TS, so using wordfreq data directly in prod would mean exporting
  static per-language tables). If single-word accuracy is mediocre but MWE
  plausibility is good, ship a hybrid: vendored table for single words, LLM
  for everything the table misses.
- **Model:** if Haiku ≈ Opus, the band can also be backfilled over the
  existing vocabulary cheaply; otherwise backfill rides along on future
  enrichment passes only.

## Results

Run 2026-07-07. Standalone Python script (scratchpad, not committed);
`wordfreq` 3.x as ground truth; ~40 API jobs, zero failures.

### Setup as executed

- **Models:** `claude-opus-4-7` (the enrichment `MODEL_OPUS` in
  `anthropic-client.ts`) and `claude-haiku-4-5-20251001`. Plain
  `messages.create`, no extended thinking, JSON-array output, batches of 50
  terms per call.
- **Sets:** A = 200 ru words stratified 20-per-half-band over Zipf 1.5–6.5,
  plus 16 inflected surface forms; B = 56 single words from the real lesson
  notes (`Sébastien.md`); C = 30 multi-word expressions from the same notes;
  D = 50 de + 50 es stratified (so two extra languages, not one).
- **Scales:** 1–5 band, 1–10 band (half-Zipf-decade bands), and direct
  continuous Zipf (one decimal). Band definitions were anchored in the prompt
  to occurrences-per-million ranges, and ground-truth bands derived from
  `zipf_frequency` with the same thresholds.
- **Prompt shapes:** batched (50/call) for everything; single-term + a
  context sentence (mimicking the basic-data pass) for 25 set-B terms on the
  1–5 scale, both models.
- **Stability:** batched 1–5 Opus on set B run 3×.

### Correlation / accuracy (batched)

Spearman is vs continuous `zipf_frequency`; ±1 accuracy is on each scale's
own bands (for the continuous condition, mapped to 1–5 bands).

| scale | model | A ru (n=200) ρ / ±1 | B notes (n=55) ρ / ±1 | D de (n=50) ρ / ±1 | D es (n=50) ρ / ±1 |
|---|---|---|---|---|---|
| 1–5 | Opus | 0.91 / 96% | 0.81 / 100% | 0.96 / 100% | 0.95 / 100% |
| 1–5 | Haiku | 0.83 / 89% | **0.54** / 100% | 0.92 / 96% | 0.92 / 96% |
| 1–10 | Opus | 0.97 / 94% | 0.78 / 95% | 0.98 / 94% | 0.97 / 78% |
| 1–10 | Haiku | 0.89 / 80% | 0.66 / 80% | 0.93 / 82% | 0.93 / 92% |
| Zipf | Opus | **0.97** / 99% | **0.82** / 98% | **0.99** / 100% | **0.99** / 100% |
| Zipf | Haiku | 0.88 / 92% | 0.77 / 100% | 0.95 / 92% | 0.93 / 94% |

Notes on reading this: set B's lower ρ is largely range restriction — real
saved vocabulary clusters in Zipf 2.5–4, so rank correlation is attenuated
while band accuracy stays 98–100%. The success criteria (ρ ≥ 0.8, ±1 ≥ 85%)
are met by Opus on every set and scale; Haiku misses ρ on the realistic set
with coarse bands but recovers to 0.77 on the continuous scale.

- **Inflected forms:** on the 14 forms where lemma and surface band differ,
  Opus's estimate was closer to the lemma band 11× vs the surface band 2× —
  it judges the lexeme as instructed.
- **Not Russian-specific:** German and Spanish were the *easiest* sets
  (ρ 0.95–0.99).

### MWE plausibility (set C, manual)

Ordering is very plausible. Top: «как можно больше» (Zipf est. 5.0), «база
данных» (4.2), «авторские права» / «искусственный интеллект» (4.0). Middle:
the everyday collocations and idioms («приём пищи» 3.5, «держаться на плаву»
3.2, «внести залог» 2.8). Bottom: «цены не кусаются» (2.3), «цифровые
кочевники» (2.0), «интервальное повторение» (1.8). **No gross inversions** —
no common idiom landed below a genuinely rare term. Spearman vs the
rarest-content-word heuristic is only 0.50, but spot-checking shows the
*heuristic* is the weaker signal (e.g. it scores «признать поражение» 4.59
because both words are common, though the collocation itself is mid-frequency
— the LLM's 3.0 is more defensible). Haiku tracks Opus within ~1 band on MWEs.

### Stability (band 1–5, Opus, set B, 3 runs)

88% of terms identical across all three runs, 100% within 1 band, max range
= 1. Comfortably inside the ≤1-band criterion.

### Prompt shape

Single-term + context sentence vs batched: always within 1 band of each other
(72–80% identical), and batched was not worse on accuracy (±1: batched
100% vs single 92–100%). Batching does not degrade estimates, and the
context sentence doesn't shift them — both integration points work.

### Decision

- **Chosen scale: direct continuous Zipf estimate (one decimal, 0–8).** It
  beat both band scales on every metric for both models, and bands can always
  be derived downstream (`floor(zipf)` reproduces the 1–5 scale). Store the
  raw value; the tier system can bucket however it likes later without
  re-enriching. 1–10 offered no accuracy advantage over 1–5 (decision rule:
  would have picked 1–5 of the two).
- **Chosen prompt shape:** ride along in the batched/basic-data pass as-is —
  one extra JSON field; shape doesn't matter.
- **Chosen model:** the existing Opus enrichment model. **Go, LLM-only** — no
  vendored frequency tables, no hybrid. Opus matches `wordfreq` closely
  enough on single words (ρ 0.91–0.99 stratified, ±1 band 96–100%) that
  corpus grounding adds nothing for a priority ordering, and it covers MWEs
  and new languages uniformly.
- **Backfill:** Haiku ≠ Opus on realistic vocabulary (ρ 0.54 on coarse bands,
  0.77 on Zipf), so per the decision rule a Haiku backfill is *marginal* —
  usable for ordering but noticeably noisier. In practice moot: batched at 50
  terms/call, an Opus backfill over the whole existing vocabulary costs a few
  dozen calls, so just backfill with Opus.
