# Exclusion-list pre-filter + tiebreaker — how they work and language support

Companion doc to `EXCLUSION_LIST_SCALING.md` (the problem framing). This one
explains the implementation that shipped, with enough detail to audit
behavior per language down the line.

## Why it exists

The basic-data pass tells the LLM "the user has already studied these
headwords — don't re-suggest them." Without the pre-filter, that exclusion
list is the user's entire vocabulary in the target language, which grows
unbounded.

Key insight: **the LLM can only suggest chunks that exist in this session's
source text.** If a headword is in the user's vocab but doesn't appear in
the current movie's subtitles, listing it as an exclusion is wasted prompt —
the LLM was never going to surface it anyway.

The pre-filter answers one question per session: **which of the user's
known headwords actually appear in this source?** Only those need to be in
the exclusion list.

This is intentionally paired with a post-pass Haiku tiebreaker. The
pre-filter keeps the expensive Opus prompt small; the tiebreaker is the
correctness gate for near-duplicate LLM suggestions that make it through.

Manual user highlights bypass both gates. If the user manually selects a
known chunk again, the app still creates a kept card for that highlight and
increments the lookup count. The dedup logic only applies to LLM-discovered
chunks — and now lives entirely inside the `discover_session` background job
(`discover-session.ts`), which is the only path that runs whole-text LLM
discovery. Per-highlight background enrichment never touches either gate.

## Stage 1 — source-relevant exclusion pre-filter

Implementation: `apps/backend/src/transport/database/user-lookups/user-lookups-repository.ts:54-93`
(`listHeadwordSensesRelevantToTrack`).

### Step 1 — aggregate the source into one tsvector

Code: `user-lookups-repository.ts:62-66`

```sql
WITH agg AS (
  SELECT to_tsvector(${cfg}::regconfig, string_agg(text, ' ')) AS source_tsv
  FROM public.text_segments
  WHERE text_track_id = ${textTrackId}
)
```

In plain English:

1. `string_agg(text, ' ')` glues every subtitle line in the track into one
   giant string ("You shall not pass... Frodo wields the sword... He has
   wielded it before...").
2. `to_tsvector('english', ...)` runs Postgres's English tokenizer on it:
   - lowercases everything
   - drops stopwords (`the`, `he`, `has`, `it`, `to`, `of`, …)
   - **stems** each remaining word (`wields`, `wielded`, `wield` → `wield`;
     `running`, `runs`, `ran` → `run`)
   - returns a deduplicated, sorted lexeme set: conceptually `{'doom',
'forsak', 'frodo', 'pass', 'shall', 'sword', 'wield', ...}`.

This aggregation runs **once** per pre-filter call. The output is one
tsvector representing the entire track.

### Step 2 — for each user_lookup row, check whether its headword appears

Code: `user-lookups-repository.ts:67-73`

```sql
SELECT ul.headword, ul.sense
FROM public.user_lookups ul
CROSS JOIN agg
WHERE ul.user_id = ${userId}
  AND ul.target_language = ${targetLanguage}
  AND ul.deleted_at IS NULL
  AND agg.source_tsv @@ plainto_tsquery(${cfg}::regconfig, ul.headword)
```

For each candidate row in the user's vocab:

- `plainto_tsquery('english', headword)` runs the same tokenizer + stemmer
  on the headword and returns a query expression
- `@@` is "does the source tsvector match this query?"

| Headword in `user_lookups` | `plainto_tsquery` produces                         | Source contains?                               | Kept?   |
| -------------------------- | -------------------------------------------------- | ---------------------------------------------- | ------- |
| `to wield`                 | `'wield'` (stopword `to` dropped, `wield` stemmed) | Yes — `wields`, `wielded` both stem to `wield` | kept    |
| `to forsake`               | `'forsak'` (stem of `forsake`)                     | Yes — `forsaken` stems to `forsak`             | kept    |
| `halfling` (hypothetical)  | `'halfling'`                                       | No — never appears                             | dropped |

In a real LOTR session, 69 vocab entries pruned to 24.

### Step 3 — kept rows feed the basic-data prompt

The surviving `(headword, sense)` pairs come back as
`excludedHeadwordSenses` and flow into
`apps/backend/src/transport/third-party/anthropic/passes/basic-data-pass.ts:222-231`,
where they're formatted into the user message of the LLM prompt.

The LLM sees a short, source-relevant exclusion list instead of the user's
entire vocabulary.

### Why "plausibly" rather than "definitely"

`plainto_tsquery` is liberal by design:

- **Stopwords drop on multi-word headwords.** `"in one's stead"` becomes
  `'one' & 'stead'` (`in` is a stopword). The match passes if the source
  contains both `one` and `stead` _anywhere_, not necessarily as the phrase.
  False positive — fine.
- **Single-stem matches across senses.** `"to run"` stems to `run`. Almost
  any English source contains `run` somewhere, so this entry is always
  kept. The pre-filter doesn't try to disambiguate sense.

Asymmetry is deliberate:

- **False positive** → exclusion list slightly fatter (cheap mistake).
- **False negative** → LLM might re-suggest a known chunk; the Haiku
  tiebreaker (`sense-disambiguation-pass.ts`) catches it downstream.

The pre-filter is _heuristic guidance_, not a correctness gate.

## Stage 2 — Haiku sense-disambiguation tiebreaker

Implementation:

- `apps/backend/src/service/processing/discover-session.ts`
  (`applySenseDisambiguationTiebreaker`)
- `apps/backend/src/transport/database/user-lookups/user-lookups-repository.ts`
  (`findPotentialExistingSensesByHeadwords`)
- `apps/backend/src/transport/third-party/anthropic/passes/sense-disambiguation-pass.ts`

After the basic-data pass returns chunks, the backend runs a second,
smaller pass only for LLM-discovered candidates that may collide with
existing vocabulary. Highlights bypass this stage entirely.

### Step 1 — choose eligible candidates

Only chunks with `source === 'llm'` and `belowCefr === false` are eligible.

- User highlights always pass through. A manual re-selection is intentional
  user input, not something dedup should hide from triage.
- Below-CEFR LLM rows become `auto_rejected`; spending Haiku tokens on them
  is not useful.

### Step 2 — find potential existing collisions

The collision lookup deliberately overmatches. For each candidate headword,
the repository returns existing `user_lookups` rows in the same
`(user_id, target_language)` where either:

1. `LOWER(existing.headword) = LOWER(candidate.headword)`, or
2. the existing and candidate headwords share at least one Postgres FTS
   lexeme under the target language regconfig.

The FTS condition is implemented conceptually as:

```sql
tsvector_to_array(to_tsvector(cfg, existing_headword))
  && tsvector_to_array(to_tsvector(cfg, candidate_headword))
```

This catches normalization drift that exact equality misses:

| Existing headword | Candidate headword | Why it collides                              |
| ----------------- | ------------------ | -------------------------------------------- |
| `to run`          | `run`              | `to` drops as a stopword; both contain `run` |
| `to wield`        | `wield`            | both stem to `wield`                         |
| `run out of`      | `to run`           | both share `run`                             |

False positives are expected. For example, `run out of` and `run into`
will probably collide because they share `run`; Haiku receives both the
candidate and existing senses and decides whether they are truly duplicate
senses.

The lookup result is keyed by the candidate headword, not the existing
headword. That matters because one candidate can collide with existing rows
whose stored headword differs (`run` → existing `to run`).

### Step 3 — Haiku decides duplicate vs distinct sense

For every colliding candidate, Haiku receives:

- candidate id
- candidate headword
- candidate sense
- candidate definition, when present
- existing senses, each including existing headword, sense, and definition

Haiku returns one decision per candidate:

- `is_duplicate = true` with `matched_existing_sense` equal to one of the
  provided existing sense strings → drop the candidate before card creation
- `is_duplicate = false` → keep the candidate; it is a distinct sense

Duplicate decisions are validated strictly. If Haiku marks a candidate as a
duplicate but omits `matched_existing_sense` or returns a sense string that
was not in the candidate's `existingSenses`, the backend rejects that
duplicate decision and keeps the candidate. The rejected decision is recorded
in telemetry as `rejectedDuplicateDecisions`.

When in doubt, the prompt tells Haiku to prefer distinct. A duplicate that
slips through can be rejected in triage; a real distinct sense dropped here
would be invisible.

### Failure behavior

The tiebreaker runs with one retry. If it still fails, processing logs a
warning, records failure telemetry, and keeps all candidates. That may let a
duplicate reach triage, but it avoids silently dropping valid study material.

## Language support tiers

Two factors determine pre-filter and tiebreaker quality per language:

1. Does Postgres ship a Snowball stemmer for it? (See
   `LANGUAGE_TO_REGCONFIG` in
   `apps/backend/src/transport/database/text-segments/text-segments-repository.ts:23-35`,
   which mirrors the `text_segments_set_tsv` trigger in the migration at
   `apps/backend/supabase/migrations/20260425215345_initial_schema.sql:289-302`.)
2. Does the language use whitespace word boundaries?

Languages outside the stemmer map fall through to the `'simple'` regconfig
in `resolveRegconfig`.

### Tier 1 — stemmer-backed, pre-filter works well (11 languages)

`en, es, fr, de, pt, ru, ar, hi, id, tr, ta`

Inflection collapses correctly: `wields / wielded / wield` all match
`to wield`; `corría / corre / correr` all match `correr`. The pre-filter
prunes effectively, and the tiebreaker collision lookup catches common
normalization drift. Telemetry should show meaningful prune ratios (e.g.
24 of 69 in the LOTR English example).

### Tier 2 — whitespace-only, no stemming (7 languages)

`bn, ur, sw, mr, te, vi, ko`

The `simple` parser tokenizes on whitespace, lowercases, dedupes — but
doesn't stem. Effects:

- Headword stored in citation form matches the source **only if the exact
  form** appears there
- Inflected occurrences are missed (a Vietnamese verb in past form won't
  match the lemma headword)

Pre-filter under-prunes — fewer exclusions reach the LLM than ideal. The
Haiku tiebreaker also has weaker recall because FTS lexeme overlap is
mostly exact-token overlap. **Correctness is still best-effort and biased
toward surfacing candidates in triage rather than silently dropping them.**

### Tier 3 — no whitespace word boundaries, pre-filter near no-op (2 languages)

`zh, ja`

Postgres's standard parser doesn't do CJK word segmentation. `to_tsvector
('simple', '我喜欢苹果')` won't break that into `我 / 喜欢 / 苹果` — it
fails to produce useful lexemes. The source tsvector is largely empty
(or contains whole-line blobs), and almost no headwords match.

Result: pre-filter returns near-zero rows for Chinese / Japanese sessions,
LLM gets little exclusion guidance, and the Haiku collision lookup may miss
duplicates because the parser cannot segment headwords reliably. The fallback
is triage: duplicates may surface, but manual rejection remains possible.

## How to audit per-language behavior

Telemetry rows for the pre-filter live in `processing_telemetry` with
`pass_name = 'exclusion_prefilter'`. The payload reports `totalVocabSize`,
`filteredSize`, and `regconfig`. Useful diagnostic SQL:

```sql
-- Prune ratio per language
SELECT
  payload->>'regconfig' AS regconfig,
  s.target_language,
  AVG((payload->>'filteredSize')::int::numeric / NULLIF((payload->>'totalVocabSize')::int, 0)) AS avg_keep_ratio,
  COUNT(*) AS pass_count
FROM public.processing_telemetry pt
JOIN public.study_sessions s ON s.id = pt.study_session_id
WHERE pt.pass_name = 'exclusion_prefilter'
GROUP BY payload->>'regconfig', s.target_language
ORDER BY pass_count DESC;
```

```sql
-- Disambiguation drop rate per language (high drop rate = pre-filter
-- letting too many duplicates through to the LLM)
SELECT
  s.target_language,
  AVG((payload->>'droppedCount')::int) AS avg_dropped,
  AVG(jsonb_array_length(payload->'candidates')) AS avg_candidates,
  COUNT(*) AS pass_count
FROM public.processing_telemetry pt
JOIN public.study_sessions s ON s.id = pt.study_session_id
WHERE pt.pass_name = 'disambiguation'
  AND payload ? 'candidates'
GROUP BY s.target_language
ORDER BY pass_count DESC;
```

A consistently high `droppedCount` means the pre-filter is letting many
duplicates reach Haiku. A consistently low `candidateCount` with obvious
duplicates still appearing in triage means the collision lookup is missing
them. For Tier 2/3 languages, either pattern can signal that better
tokenization would pay off.

## Future improvement paths (not urgent)

For CJK specifically, two options if pre-filter quality becomes a
bottleneck:

1. **Postgres extensions** — `pg_jieba` for Chinese, `pgroonga` (with
   MeCab) for Japanese. Server-side; requires Supabase to allow the
   extension. Cleanest drop-in.
2. **App-side segmentation** — segment text in Node before storage
   (`nodejieba`, `kuromoji`), store pre-segmented text or a derived
   column. More moving parts.

Other Tier 2 languages (Bengali, Urdu, Korean, etc.) would benefit from
language-specific stemmers but the lift is similar to CJK and the win is
smaller — Haiku already absorbs the slack acceptably.

For MVP scale, leaving all of Tier 2/3 to fall through to `'simple'` is
the right call. Revisit when telemetry shows a problem.
