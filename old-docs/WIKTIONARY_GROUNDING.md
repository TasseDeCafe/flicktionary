# Wiktionary Grounding — Implementation Plan

> **Status:** ready to build. Kaikki Russian dump is already loaded into the local
> dev-tunnel DB; schema for `wiktionary_entries` + `wiktionary_forms` is in the
> initial migration. Loader script exists. Card-level integration is what
> remains.

## Context

LLM-generated `card.grammar` fields hallucinate frequently for Russian (gender
on soft-sign-masculine nouns, aspect pairs, government, indeclinable flags).
The user manually verifies on Wiktionary, which doesn't scale.

**Approach.** Embed structured Wiktionary data ([kaikki.org dumps](https://kaikki.org/))
as reference data in our Postgres. After the basic-data pass produces a card,
look up the headword in `wiktionary_entries` and **deterministically merge
high-confidence grammar fields** — kaikki wins, LLM fills gaps. No LLM
verification call, no live Wiktionary scraping.

Goals:
- Eliminate hallucinations on the **structured** Russian grammar fields.
- Default behavior unchanged (pure LLM); kaikki layer is opt-in per language
  via `KAIKKI_ENABLED_LANGUAGES = new Set(['ru'])`. Future languages added
  one at a time as we validate their kaikki data quality.
- Surface a card-level badge so the user knows whether a card is grounded.

## What already exists

### Schema

These tables now live in the canonical migration history under
`apps/backend/supabase/migrations/`. This document is historical; do not edit
the old initial/consolidated migration files when making new schema changes.
Create a new migration with `doppler run -- supabase migration new <name>` from
`apps/backend/supabase/supabase-dev-tunnel/`, then edit only that new file.

```sql
CREATE TABLE public.wiktionary_entries (
  id BIGSERIAL PRIMARY KEY,
  target_language TEXT NOT NULL,
  headword TEXT NOT NULL,
  pos TEXT NOT NULL,
  data JSONB NOT NULL  -- full kaikki entry, untouched
);
CREATE INDEX idx_wiktionary_entries_lookup ON public.wiktionary_entries (target_language, headword);
CREATE INDEX idx_wiktionary_entries_pos ON public.wiktionary_entries (target_language, pos);

CREATE TABLE public.wiktionary_forms (
  target_language TEXT NOT NULL,
  form TEXT NOT NULL,
  entry_id BIGINT NOT NULL REFERENCES public.wiktionary_entries(id) ON DELETE CASCADE,
  PRIMARY KEY (target_language, form, entry_id)
);
CREATE INDEX idx_wiktionary_forms_lookup ON public.wiktionary_forms (target_language, form);
```

Both tables have `ENABLE ROW LEVEL SECURITY` with no policies — backend
postgres-role connection bypasses RLS, anon/authed clients have no access.

### Loader script

`apps/backend/scripts/load-kaikki.ts`. Run with `pnpm load:kaikki` from
`apps/backend`. Idempotent: TRUNCATEs both tables before loading. Caches the
JSONL at `apps/backend/scripts/.cache/kaikki/` so repeated runs skip the
download. Only Russian for now (`TARGET_LANGUAGE = 'ru'` is hardcoded). At the
end of a successful load, auto-snapshots the wiktionary tables to
`apps/backend/scripts/.cache/wiktionary/wiktionary.dump` for use by
`db:dev:tunnel:reset`.

When extending to a new language: parameterize `TARGET_LANGUAGE` + `KAIKKI_URL`
+ `JSONL_FILENAME`, run once per language. The forms table's stress-stripping
logic is Russian-specific — non-Cyrillic languages will need their own
normalization rules.

### Reset wrapper

`apps/backend/scripts/db--dev-tunnel--reset.sh`. Invoked via
`pnpm db:reset` (root) or `pnpm --filter @flicktionary/backend
db:dev:tunnel:reset`. Three phases:

1. If `.cache/wiktionary/wiktionary.dump` is missing AND the wiktionary tables
   exist AND have data, take a `pg_dump --data-only -Fc` snapshot.
2. Run `supabase db reset` (drops + reapplies migrations + reseeds).
3. If a snapshot exists, `pg_restore` the wiktionary tables back.

Both `pg_dump` and `pg_restore` run inside the supabase Postgres container
(`docker exec`) so client-tool versions always match the server. Atomic
rename pattern (`*.tmp` → `*.dump` only on success) guards against partial
writes leaving zero-byte files behind.

**Required preconditions:** the dev-tunnel containers must be running
(`pnpm db:dev:tunnel`), and `pnpm load:kaikki` must have been run at least
once before the first `db:reset` — otherwise there's nothing to snapshot
and the script will print a notice telling you to run the loader.

### Loaded Russian data (counts at time of writing)

- 441,338 entries total
  - ~57k **real lemmas** (have `head_templates`, contain rich grammar)
  - ~384k **form-of pseudo-entries** (one per inflected form, point back via
    `senses[0].form_of[0].word`)
- 1,464,121 form-table rows (stress-stripped, with kaikki internal pseudo-forms
  filtered out: `romanization`, `class`, `inflection-template`, `table-tags`,
  `-` placeholders)
- Disk: ~720 MB entries, ~260 MB forms — fits the 50 GB Supabase Pro tier
  comfortably; English / Spanish / French / Portuguese will each add similar.

## Locked decisions

1. **Default = pure LLM.** Grounding only kicks in when
   `target_language ∈ KAIKKI_ENABLED_LANGUAGES`. v1 = `{'ru'}`.
2. **Hook point.** New post-processing step after the basic-data pass in
   `process-session.ts`. Cards land at triage already grounded.
3. **Merge rule.** Kaikki value overrides LLM value when both present. LLM
   value is preserved when kaikki is silent on that field.
4. **Form-of resolution.** When the user-facing headword hits a form-of
   pseudo-entry, automatically resolve to its underlying lemma (where the rich
   grammar lives). The pseudo-entry's `senses[0].form_of[0].word` is the
   stressed lemma form; strip stress and re-look-up.
5. **Aspect-pair multi-values.** Kaikki sometimes returns multiple pairs
   (e.g. `класть → положи́ть,сложи́ть`). Store the full list, but the focus view
   surfaces only the first. (Schema-wise: `aspect_pair_headword` stays as a
   single string; alternatives go into `aspect_pair_alternatives` array within
   the grammar JSONB. Or just store the first and drop the rest — see
   "Implementation notes" below for the trade-off.)
6. **`government` field deferred.** The data exists in kaikki's
   `senses[].raw_glosses` as bracketed parentheticals (`[with от (ot, +
   genitive)]`), but extraction needs regex parsing or a tiny LLM call. v1
   leaves `government` as LLM-only. Add a TODO comment in the grounding module
   pointing future work at `raw_glosses`.
7. **Stress class skipped.** Wiktionary's Zaliznyak class letters are only
   present in `head_templates[0].args.1` for ~9% of nouns and the user doesn't
   need them — the full stressed paradigm is in `data->'forms'`.
8. **Card badge: card-level only for v1.** Single ✓ "Verified against
   Wiktionary" / ⚠ "LLM only" indicator in the focus view. Per-field markers
   are a possible v2 refinement.

## Schema addition

Historical note: this section originally described adding `grounded_at` during
pre-deploy schema consolidation. For any new schema/data change, do not append
to or rewrite an existing migration. Create a new migration from
`apps/backend/supabase/supabase-dev-tunnel/`:

```bash
doppler run -- supabase migration new <name>
```

Then edit only the newly created file in `apps/backend/supabase/migrations/`
and verify with:

```bash
doppler run -- supabase db reset --local
```

The historical SQL shape was:

```sql
grounded_at TIMESTAMP WITH TIME ZONE NULL,  -- set when wiktionary grounding
                                            -- merged kaikki data into this
                                            -- card. null = pure LLM.
```

From the repo root, `pnpm db:reset` runs the dev-tunnel reset wrapper. From
backend package scope, use
`pnpm --filter @flicktionary/backend db:dev:tunnel:reset`; there is no backend
`db:reset` script.

## Implementation

### New module: `apps/backend/src/service/wiktionary-grounding/`

```
wiktionary-grounding/
  index.ts       — public API: `groundCard(card): Promise<GroundedResult>`
  lookup.ts      — find the right wiktionary entry for a (lang, headword, pos)
  extract.ts     — pure functions extracting Grammar fields from a kaikki entry
  merge.ts       — deterministic merge: kaikki wins, LLM fills gaps
  config.ts      — `KAIKKI_ENABLED_LANGUAGES = new Set(['ru'])`
```

### Lookup chain (`lookup.ts`)

```ts
async function findEntry(targetLanguage: string, headword: string, pos: string) {
  if (!KAIKKI_ENABLED_LANGUAGES.has(targetLanguage)) return null

  // 1. Direct (lang, headword, pos) hit on real lemmas.
  let entry = await sql`
    SELECT * FROM public.wiktionary_entries
    WHERE target_language = ${targetLanguage}
      AND headword = ${headword}
      AND pos = ${pos}
      AND data ? 'head_templates'
      AND NOT (data->'senses'->0 ? 'form_of')
    LIMIT 1
  `

  // 2. Same but POS-agnostic (homonym disambiguation lives elsewhere; if pos
  //    mismatches, prefer the LLM's POS but accept kaikki's other-POS data
  //    rather than nothing).
  if (!entry) entry = await sql`
    SELECT * FROM public.wiktionary_entries
    WHERE target_language = ${targetLanguage}
      AND headword = ${headword}
      AND data ? 'head_templates'
      AND NOT (data->'senses'->0 ? 'form_of')
    LIMIT 1
  `

  // 3. Form-of pseudo-entry direct hit (LLM normalized to a form rather than
  //    the lemma). Resolve to the underlying lemma.
  if (!entry) {
    const formOf = await sql`
      SELECT data->'senses'->0->'form_of'->0->>'word' AS lemma_with_stress
      FROM public.wiktionary_entries
      WHERE target_language = ${targetLanguage}
        AND headword = ${headword}
        AND data->'senses'->0 ? 'form_of'
      LIMIT 1
    `
    if (formOf?.lemma_with_stress) {
      const lemma = stripStress(formOf.lemma_with_stress)
      entry = await sql`SELECT * FROM public.wiktionary_entries
        WHERE target_language = ${targetLanguage}
          AND headword = ${lemma}
          AND data ? 'head_templates'
        LIMIT 1`
    }
  }

  // 4. wiktionary_forms fallback (LLM normalized to a slightly off form).
  if (!entry) entry = await sql`
    SELECT e.*
    FROM public.wiktionary_forms f
    JOIN public.wiktionary_entries e ON e.id = f.entry_id
    WHERE f.target_language = ${targetLanguage}
      AND f.form = ${headword}
      AND e.data ? 'head_templates'
      AND NOT (e.data->'senses'->0 ? 'form_of')
    LIMIT 1
  `

  return entry  // null if all four paths missed
}
```

`stripStress` = `s => s.replace(/́/g, '')` (combining acute accent).

### Extraction (`extract.ts`)

#### `display_form` — always, regardless of POS

The first token of `head_templates[0].expansion` (everything before ` • `) is
the surface form (with stress when applicable). 98.7% of noun lemmas, 96% of
verbs, 93% of adjectives have explicit stress marks; the remainder are
monosyllabic or contain `ё` (which is inherently stressed in Russian — no
mark needed). 1.3% are genuinely unmarked due to source data gaps; for those
we still get the form, just without explicit stress.

```ts
function extractDisplayForm(entry: KaikkiEntry): string | null {
  const expansion = entry.head_templates?.[0]?.expansion
  if (!expansion) return null
  const idx = expansion.indexOf(' • ')
  return idx === -1 ? null : expansion.slice(0, idx).trim() || null
}
```

#### Verbs (`pos = 'verb'`, `head_templates[0].name = 'ru-verb'`)

`args` is reliable for verbs:

```ts
const args = entry.head_templates[0].args  // { '1': string, '2': string, impf?, pf? }
const aspect = args['2']                   // 'pf' | 'impf' | 'biaspectual'
const aspectPairRaw = args.impf ?? args.pf // string, sometimes comma-separated
const aspectPairs = aspectPairRaw?.split(',').map(s => stripStress(s.trim())) ?? []
const aspect_pair_headword = aspectPairs[0] ?? null
const is_reflexive = entry.headword.endsWith('ся') || entry.headword.endsWith('сь')
```

Reflexive verbs are stored as separate top-level kaikki entries (the lemma
includes the `-ся` suffix). The LLM convention should match — if it doesn't,
the `is_reflexive` derivation from headword will misalign and need adjustment.

#### Nouns (`pos = 'noun'`, `head_templates[0].name ∈ {'ru-noun', 'ru-noun+'}`)

**Don't trust `args.1`** — it's sometimes the cyrillic form, sometimes a
Zaliznyak class letter (`b`, `f'`, `c (1)`), depending on which invocation
style the Wiktionary editor used. There's no pattern by word shape; both
column types appear across every stress position. Always parse `expansion`
instead.

The relevant chunk of `expansion` is the parenthesized header right after the
bullet: `"кни́га • (kníga) f inan (genitive кни́ги, ...)"`. Pattern:

```
^<form> • (<romanization>) <gender>[ <animacy>][ pl][...indeclinable...]...
```

Extraction:

```ts
const expansion = entry.head_templates[0].expansion
// After the romanization parens, the next tokens carry gender/animacy/etc.
const afterRoman = expansion.match(/\)\s+(.+?)(?:\s*\(|$)/)?.[1] ?? ''
//   afterRoman examples:
//     "f inan"            → книга
//     "m inan"            → стол
//     "f anim"            → мать
//     "m inan or n inan"  → кофе (ambiguous)
//     "f inan pl"         → ножницы
//     "m anim"            → ...

const genderMatch = /\b(m|f|n|c)\b/.exec(afterRoman)
const gender = genderMatch?.[1] ?? null  // 'm' | 'f' | 'n' | 'c'

const animacyMatch = /\b(anim|inan)\b/.exec(afterRoman)
const animacy = animacyMatch?.[1] === 'anim' ? 'animate'
  : animacyMatch?.[1] === 'inan' ? 'inanimate' : null

const number_only = /\bpl\b/.test(afterRoman) ? 'plurale_tantum' : null

const is_indeclinable = /\bindeclinable\b/i.test(expansion) || null
```

For ambiguous gender (`"m inan or n inan"`), pick the first (`'m'`) and
optionally drop a `processing_warnings` entry on the session noting
ambiguity. Or store as `'m | n'` — schema decision; current `gender` enum
in `card.grammar` is a single value, so picking-first matches the schema.

#### Adjectives (`pos = 'adj'`, `head_templates[0].name = 'ru-adj'`)

Just `display_form`. The `args.2`/`args.3` fields are comparative/superlative
forms — useful for the rendered Wiktionary panel later, not for the structured
grammar bag.

### Merge (`merge.ts`)

```ts
function mergeGrammar(
  llmGrammar: Grammar,
  kaikkiGrammar: Partial<Grammar>
): Grammar {
  // Kaikki wins where it has data; LLM fills gaps.
  return { ...llmGrammar, ...filterUndefined(kaikkiGrammar) }
}
```

Skip undefined/null kaikki values so we don't overwrite a populated LLM
field with a kaikki absence.

### Hook point (`process-session.ts`)

After the basic-data pass writes its cards, before the response is sent
back to the frontend:

```ts
if (KAIKKI_ENABLED_LANGUAGES.has(session.target_language)) {
  for (const card of newlyCreatedCards) {
    const entry = await findEntry(session.target_language, card.headword, card.grammar?.pos ?? 'noun')
    if (!entry) continue
    const groundedFields = extractGrammar(entry)
    if (Object.keys(groundedFields).length === 0) continue
    await sql`
      UPDATE public.cards
      SET grammar = ${sql.json({ ...card.grammar, ...groundedFields })},
          grounded_at = NOW(),
          updated_at = NOW()
      WHERE id = ${card.id}
    `
  }
}
```

Run sequentially (per-card) for simplicity; can batch into a single SQL
UPDATE later if performance matters. For a 25-card session: 25 lookups × ~1ms
each = negligible vs the basic-data LLM pass that just ran.

### Frontend: focus view badge

Add a small chip near the card's headword in the focus view (component is
under `apps/web/src/...` — find it via grep on `display_form` or the existing
grammar panel rendering).

```tsx
{card.grounded_at ? (
  <Badge variant="success" title={`Verified against Wiktionary on ${formatDate(card.grounded_at)}`}>
    ✓ Wiktionary
  </Badge>
) : KAIKKI_LANGUAGES.has(session.target_language) ? (
  <Badge variant="warning" title="LLM-only — not found in Wiktionary">
    ⚠ LLM only
  </Badge>
) : null}
```

The `KAIKKI_LANGUAGES` set lives in core (mirror of the backend's
`KAIKKI_ENABLED_LANGUAGES`). Languages outside the set get no badge — the
absence of grounding is the default state and doesn't need explanation.

## Verification

1. **Unit tests** for `extract.ts` against fixed kaikki entries (вoplate a
   handful of representative entries — verb pf/impf, noun m/f/n, ножницы as
   plurale_tantum, кофе as indeclinable, обнаружить as the canonical case).
   Pure functions, easy to test.
2. **Integration sanity** by re-processing a Russian session that already
   has cards, checking the focus view shows the ✓ badge and that obvious
   grammar fields match Wiktionary.
3. **Manual smoke** in dev: pick a chunk like `обнаружить`, kick off
   processing, confirm:
   - `display_form = "обнару́жить"` (with stress)
   - `aspect = "pf"`
   - `aspect_pair_headword = "обнаруживать"`
   - `is_reflexive = false`
   - `grounded_at` is set
   - Focus view shows ✓ badge

Sample SQL probe to validate end-to-end after running:

```sql
SELECT c.headword, c.grammar->>'display_form' AS display_form,
       c.grammar->>'aspect' AS aspect,
       c.grammar->>'aspect_pair_headword' AS aspect_pair,
       c.grounded_at IS NOT NULL AS grounded
FROM public.cards c
JOIN public.study_sessions s ON s.id = c.study_session_id
WHERE s.target_language = 'ru'
ORDER BY c.created_at DESC
LIMIT 20;
```

## Out of scope for v1

- **Government extraction** from `raw_glosses`. Data is there as `[with X (..., +
  case)]`. Add a TODO comment in `extract.ts` so this is discoverable when
  someone wants to pick it up.
- **Etymology / IPA / collocations** from kaikki. These belong to the existing
  `Generate full exploration` enrichment pass; consider feeding kaikki data
  into that pass's prompt as additional context once basic grounding is
  stable.
- **Sense-matching.** Wiktionary lists multiple senses; we don't try to pick
  which one matches the source context. For grammar fields this doesn't
  matter (gender / aspect / animacy are sense-independent). For sense-specific
  enrichment fields (etymology that varies by sense, register tags) it does —
  v2 problem.
- **Multi-language support.** v1 ships Russian. To add a language: download
  its kaikki dump, parameterize the loader, validate `head_templates` shape
  for that language (Spanish/French/etc. will have different template names
  and arg conventions), add to `KAIKKI_ENABLED_LANGUAGES`.
- **Re-grounding existing cards.** The hook fires only on new cards. Existing
  Russian cards stay LLM-only until reprocessed. A "Re-ground all my Russian
  cards" admin action could be added later if useful.
- **Production deployment.** The loader runs against any connection string;
  pointing it at the prod Supabase URL takes ~10 minutes. Schedule for after
  the feature is verified locally.

## File checklist

When implementing, expect to touch:

- `apps/backend/supabase/migrations/<new timestamp>_<name>.sql` — append-only
  migration for any new schema/data change. Do not edit the initial schema
  migration in place.
- `apps/backend/src/service/wiktionary-grounding/{index,lookup,extract,merge,config}.ts`
  — new module.
- `apps/backend/src/service/process-session.ts` (or wherever the basic-data
  pass writes cards — find via grep on `cards` writes) — invoke the
  grounding step.
- `apps/backend/src/service/cards/...` — if there's a `cards.updateFields`
  ORPC, double-check that `grounded_at` is preserved (not silently nulled)
  when the user edits a grammar field manually. The intent: editing a
  field doesn't un-ground the card — the badge keeps reflecting "kaikki was
  consulted at processing time."
- `packages/api-client/...` and the focus-view rendering component — expose
  `grounded_at` on the card type and render the badge.
- `packages/core/src/constants/...` — add a `KAIKKI_LANGUAGES` set mirroring
  the backend's enabled set, so the frontend badge logic doesn't drift.
