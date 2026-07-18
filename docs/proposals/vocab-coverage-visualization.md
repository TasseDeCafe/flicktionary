# Vocabulary coverage visualization ("how much of the language do I know?")

> **Status: proposal — data layer implemented, grid not.** A design for a
> dashboard progression visualization: every lemma of the target language as a
> dot, colored by knowledge state, with a token-coverage headline stat and a
> per-text "mark all other words as known" action. Includes the results of the
> ru/de feasibility spikes (2026-07-12) that validated the data pipeline.
> Implemented via the checkpoint-reviews rollout phase 2: the `lemma_ranks`
> build (a DB-side build over the loaded kaikki tables through
> `checkpoint_fold` — superseding this doc's dump-CSV approach — plus a
> `lemma_rank_builds` manifest; no separate `form_to_lemma` table, per the
> checkpoint proposal's deltas), the `known_lemmas` table, and the per-session
> mark-the-rest-known sweep + gloss-sheet un-mark chip. See
> `docs/DATA-MODEL.md` / `docs/READER-SPEC.md` for as-built behavior. The
> grid itself, the claimed/verified split, and bulk un-mark by source remain
> unimplemented.

## Problem / motivation

The app has no gamification. Streaks and XP are generic; what fits this product
is making *progress through the language itself* visible: a picture of how much
of the target language's vocabulary the learner knows, deepening over time.

The accuracy bar is deliberately modest: this is a motivating instrument, not a
linguistic measurement. Systematic small errors are acceptable; what matters is
that the picture is stable, monotonically improving, and roughly honest.

## Product shape

- **The grid.** A canvas of dots, one per lemma of the language, ordered by
  frequency rank (top-left = most frequent). Three states: **studied** (the
  lemma has a `user_lookups` row — optionally shaded by FSRS stability so the
  grid shows memory strength), **marked known** (bulk-marked, below), and
  **unknown**. Default view: the top ~10k lemmas; full denominator (~30-50k)
  as a zoomed-out aspirational view. Rank-ordering makes the *shape* of the
  scatter meaningful: dense top-left + sparse tail = knows the core, reads
  narrow content, etc.
- **The headline stat: token coverage.** "The words you know cover N% of
  typical text" — the sum of corpus-frequency mass of known lemmas. Not a raw
  count: Zipf's law means the count is dominated by a tail that contributes
  nothing to comprehension, while coverage-% moves fast early (top 1,000
  lemmas ≈ 74-79% of running text in ru/de) and turns into a satisfying grind
  toward 95%+ — a real difficulty curve with no artificial points. Coverage-%
  is also roughly comparable across languages, which lemma/form counts never
  are (LingQ-style form counting inflates Russian ~4-5x vs English).
- **"Mark all other words as known"** — a per-text action: every token of the
  text that resolves to a lemma and is neither studied nor already marked gets
  a `known_lemmas` row. Tokens that don't resolve (proper nouns, numbers,
  typos, foreign words) are silently skipped — the resolution failure is
  itself the filter.
- **Multi-word expressions stay out of the grid.** Frequency lists are
  single-token; MWEs (headwords with spaces, `pos: 'phrase' | 'idiom'`) can't
  be produced by single-token resolution. Show them as a separate counter
  ("+ N expressions") next to the grid.
- If a bulk-marked lemma is later looked up and saved, the `user_lookups` row
  wins: the dot upgrades from "marked known" to "studied".

## Why lemmas (not raw forms)

`user_lookups` is already lemma-keyed — `headword` is the LLM-normalized
citation form (`docs/DATA-MODEL.md`), enforced by the basic-data pass
(`apps/backend/src/transport/third-party/anthropic/passes/basic-data-pass.ts`).
Raw-form counting would require data the canonical vocabulary record doesn't
keep, and it makes counts incomparable across languages. The classic objection
to lemmas — "you'd have to lemmatize arbitrary text at runtime" — dissolves
because the *frequency list* is lemmatized once, offline; runtime is a hash
lookup (next section).

The existing `user_lookups.zipf_estimate` (LLM point estimate, used for
new-term priority ordering) is **not** usable as the denominator: it exists
only for saved terms and cannot enumerate or stably rank the language. It
stays for prioritization; this feature needs its own static ranked asset.

## Data design

### Offline asset build (per language)

Join two sources, both already in reach:

1. **wordfreq** (Python lib; the same source the zipf-band experiment used as
   ground truth) — corpus frequency per *surface form*.
2. **kaikki/Wiktextract** — the form→lemma mapping, from the same dumps the
   grounding loader (`apps/backend/scripts/load-kaikki.ts`) already ingests:
   paradigm tables on lemma entries plus form-of/alt-of stub entries.

For each surface form in wordfreq's top ~50k: resolve to candidate lemmas,
split its frequency mass across candidates weighted by each candidate's own
corpus frequency, sum per lemma, rank lemmas by total mass. Output two tables:

- `lemma_ranks (target_language, lemma, rank, freq_mass)` — the denominator,
  ~30-50k rows/language.
- `form_to_lemma (target_language, form, lemma)` — the runtime resolver,
  ~500k-1M rows/language. Not the same as the existing `wiktionary_forms`
  table: it needs the folding rules below, which the loader doesn't apply.

The build is a standalone script (Python or TS calling a Python step for
wordfreq); it runs rarely (new language, list revision) and the outputs are
versioned data, not user data.

### Build rules (established by the spikes — all required)

Generic:

- Exclude `pos = 'character'` entries (letter names shadow one-letter
  prepositions: Cyrillic "В", etc.).
- Exclude multi-word lemmas from the single-token map.
- Fold form-of/alt-of stub entries into their targets **transitively, 2 hops**
  (de: `dies` → alt-of → `dieses` → form-of → `dieser`).
- Split ambiguous forms' mass weighted by candidate-lemma corpus frequency,
  **never evenly** (even splitting put ru `кака` at rank 28 by stealing half
  of `как`'s mass).
- Denominator = real word tokens only (per-language script regex; digits,
  latin loans in ru, single letters, symbols are out).
- Lookups must **union** the exact and capitalized keys and let weights
  arbitrate — never first-match (de `augen` alone matched rare verb `äugen`
  and silently took `Auge`'s whole plural).

Per-language folds:

- ru: strip U+0301 stress marks (loader already does); **ё→е folding** both
  ways — the single largest unmatched class before the fix (`шел`, `идет`,
  `нее`).
- de: **ß→ss folding** (`heisst`→`heißen`, `liess`→`lassen`); **case-twin
  discount** — when a capitalized lemma's lowercase twin is also a candidate,
  discount the capitalized one (×0.02): wordfreq is caseless, so `Auch` (town)
  otherwise splits 50/50 with `auch` (same for `Ich`/`Aber` nouns).

### Spike results (2026-07-12)

Method: full kaikki dumps (ru per-language dump, 441,338 entries; de filtered
from the raw dump, 366,103 entries) joined against wordfreq's top 50k forms.
Prod `wiktionary_*` tables were verified fully loaded (ru 441k entries/1.46M
forms, de 367k/1.49M, en 1.47M/908k). Note: the cached
`apps/backend/scripts/.cache/kaikki/entries.csv`/`forms.csv` in the main
checkout are truncated artifacts of an interrupted run — do not use them.

| | ru | de |
|---|---|---|
| word-token types matched | 91.6% | 79.7% |
| **token mass matched** | **97.6%** | **96.6%** |
| forms with a single candidate lemma | 87% | 83% |
| proper-noun-only mass | 2% | 2% |
| coverage of top 1k lemmas | 74.5% | 79.4% |
| coverage of top 5k lemmas | 94.3% | 93.2% |
| coverage of top 10k lemmas | 98.9% | 97.2% |
| denominator size (lemmas with mass) | ~16k | ~30k |

The de type-match rate is lower only because its unmatched tail is
abbreviations/acronyms/English loans (`bzw`, `GmbH`, `SPD`, `the`) — mass
match is what matters. Spot checks all resolve: ru `шёл`/`шел`→`идти`,
`детей`→`ребёнок`/`дитя`, `стали`→`сталь`/`стать`; de `ging`→`gehen`,
`häuser`→`Haus`, `wusste`→`wissen`, `dies`→`dieser`. Top-60 rankings for both
languages read as textbook frequency lists. en was not spiked: minimal
inflection makes it the structurally easy case.

Known artifacts (accepted for v1):

- **Rare-verb homographs of function-word forms** self-inflate: de verb
  `einen` ("to unify") ranks ~27 because its citation form is spelled like
  the article's accusative, so frequency-weighting credits it a share of
  `eine`/`einen` mass. Order one-per-language; fix later with POS-tagged
  frequencies or a small per-language blocklist.
- **Separable verbs** (de): finite separated forms credit the base verb
  (`fängt` → `fangen`, not `anfangen`). Prefixed lemmas still rank via their
  single-token forms (infinitive/participle/preterite: `anfangen` 124/M,
  `aussehen` 123/M) — slightly underweighted, not absent. 1.5M multi-token
  paradigm cells are dropped by design.
- Same-spelling lemmas across POS collapse into one grid dot (de `sein`
  verb+possessive). Fine for a progress picture.

### User data

New table (never rows in `user_lookups` — thousands of bulk marks would
pollute the SRS queues and review surfaces):

```
known_lemmas (
  user_id uuid,
  target_language text,
  lemma text,          -- keyed by text, not rank: survives list revisions
  source text,         -- 'bulk_text' | 'manual', plus source_id if useful
  marked_at timestamptz,
  PRIMARY KEY (user_id, target_language, lemma)
)
```

Scale is trivial (a heavy reader ≈ 20-30k rows). Dashboard queries are one
join of `known_lemmas` + `user_lookups.headword` against `lemma_ranks`.

### Runtime flows

- **Mark-all-known:** tokenize the text's segments (already stored;
  `Intl.Segmenter` covers zh/ja later), lowercase-preserving lookup into
  `form_to_lemma` (exact ∪ capitalized), diff against existing
  headwords + known lemmas, bulk insert. Ambiguous forms mark **all**
  candidate lemmas — over-crediting one rare homograph is invisible noise.
  No LLM anywhere in the loop; milliseconds of SQL.
- **Coverage stat:** `SELECT sum(freq_mass) FROM lemma_ranks WHERE lemma IN
  (known ∪ studied)` over the per-language total.
- **Grid:** ship the client rank-ordered known/studied rank indices; render
  on canvas (50k dots is a ~250×200 block).

## Rollout

1. ru + de + en (kaikki already loaded for grounding; spikes done for the
   hard two). Other languages as wordfreq/Wiktionary coverage allows — same
   quality-tier posture as grounding.
2. Asset build script + tables + `known_lemmas`.
3. Dashboard card: grid + coverage stat + MWE counter.
4. Mark-all-known button on text/session views.

## Open questions

- How much to trust bulk marks in the headline number: one blended coverage
  %, or "verified vs claimed" split (studied-only vs studied+marked)? The
  three-state grid coloring may be enough honesty on its own.
- Per-text undo for a careless bulk mark ("unmark words from this text" —
  needs `source_id` on `known_lemmas`).
- Whether passive signal (lemmas repeatedly read without highlighting) should
  ever auto-suggest known-marking, or the button stays the only entry point.
- Where the dashboard card lives (no dashboard surface exists today).
