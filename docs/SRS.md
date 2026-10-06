# How the SRS works

The **single authoritative spec** for the practice/SRS system (web app): data model,
scheduler, budgets, queues, parking/exercises, and the practice UI surfaces.
`SPEC.md` carries only a summary + pointer here. Describes current behavior. Update this
doc alongside behavior changes — same convention as `apps/extension/EXTENSION-SPEC.md`.

Code map:

- Scheduler: `apps/backend/src/service/practice/fsrs.ts` (`ts-fsrs` wrapper)
- Rating flow: `rate-term.ts` (`applyTermRating`, `rateTerm`); undo: `undo-rating.ts`
- Flashcard selection: `list-due-review-terms.ts` + `listDueReviewTerms` / `listOptInNewFacets` in
  `user-lookups-repository.ts`
- Composed queue: `plan-practice-queue.ts`, `compose-practice-queue.ts`,
  `claim-practice-introduction.ts`
- Daily budgets: `review-caps.ts` (`resolveReviewCaps`, `clampPracticeSessionLimits`)
- Leeches: `leech-config.ts`, `rehab.ts`, `exercise-bank.ts`
- Audit log: `practice-rating-events-repository.ts`
- Frontend session: `apps/web/src/features/practice/components/composed-practice-view.tsx` (render),
  `use-composed-session.ts` (side effects), `composed-session-reducer.ts` (bookkeeping)

All "today" windows below use the **server's `CURRENT_DATE`** (Postgres, UTC) — not the
client's timezone.

## 1. Data model: terms and facets

A `user_lookups` row — the **term** — is created per (user, target_language, headword, sense)
when the user keeps a card (`set-card-status.ts`; `findOrCreate` + `applyKeepTransition` bumps
`count`). Rows with `count = 0` or `deleted_at` set are invisible to practice. The term holds
the *content* (headword/sense/translation/grammar); it no longer holds any SRS state.

Each independently-scheduled card is a **facet** — one `public.study_facets` row
(`study-facets-repository.ts`) keyed by `(user_lookup_id, skill, target_form)`, owning its own
FSRS + leech-rehab state and `introduced_at`. A facet is a `(skill, target_form)` pair on a
term:

- **skill** — `meaning_recognition` | `meaning_production` | `pronunciation` (the last is
  recognition-mode — see §pronunciation below; pronunciation can be per-form).
- **target_form** — `''` is the citation/lemma; a non-empty string is a specific inflected form.

`pool` (`recognition`/`production`) stays on the wire and route params unchanged, but it is **derived**:
it is the review mode of a skill, mapped at the service boundary (`skillForPool` /
`reviewModeForSkill`), not a stored column. The passive queue serves the recognition skills
`{meaning_recognition, pronunciation}`; the active queue serves `meaning_production`.

| | passive (recognition) | active (production) |
|---|---|---|
| Facet skill | `meaning_recognition`, `pronunciation` | `meaning_production` |
| Daily caps | shared new + review budgets | shared new + optional review budget |
| Stamps `introduced_at` on citation introduction | yes | yes |
| Counts toward review budget | yes | yes (when configured) |
| 24h interval floor | yes | no |
| Card layout | headword front | prompt front (`PRODUCTION_CARD_FACE_CONFIG`) |

- Keeping a term creates a `(meaning_recognition, '')` facet **as a default** (atomic with the
  `count` bump; `ensureDefaultCitationFacetIfUnconfigured`, idempotent) — but only when the term
  has no facet rows yet. A study-target configuration made before Keep (e.g. pronunciation-only
  picked in the focus view) is respected, not overwritten; a dormant (all-skills-disabled)
  term is not resurrected by a re-keep. A `(meaning_production, '')` facet exists only once
  production is enabled.
- **Study intent** (gloss-save popovers): `highlights.create` / `cards.createAdhoc` accept an
  optional `studyIntent {skills, formScope}` — a **full-set** facet configuration (recognition
  only if listed) applied by `applyStudyIntent` once the term exists: inline for adhoc (before
  the keep transition, so the keep default's row-existence check is skipped), and in the
  `enrich_highlight` job for highlights (the intent is stored on the highlight row;
  `study_intent_applied_at` is stamped atomically with the facet writes so a job retry never
  re-applies). Application is enable-only and additive on term dedupe. `formScope:'both'` adds
  per-form facets of the encountered surface for ALL listed skills — pronunciation included
  (lemma-collapse when the surface IS the headword), born
  `pending_data`/`source='highlight'` and auto-filled via the Opus pass (one call per form,
  meaning skill first; sibling skills copy the payload — the pronunciation sibling only when it
  carries displayable form IPA).
- `srs_state IS NULL` on a facet = never reviewed — the UI's **"Unseen"**.
- `introduced_at` (on the two citation facets — recognition AND production, which share one
  combined daily budget) is the source of truth for the daily-new count; it replaces the old
  `user_lookups.added_to_practice_at`.
- **Membership vs existence**: there is **no `learning_mode` column** (dropped in migration
  `drop_learning_mode`). "In production" means an *enabled*
  (`disabled_at IS NULL`) citation production facet, never mere row existence: a demoted term
  keeps its production facet (history intact) with `disabled_at` set. The wire still exposes a
  **derived** `learningMode` (`'active'` iff that facet is enabled) for read-only surfaces (vocab
  filter pills/chips). Enable/disable is one unified write — `chunks.setFacetEnabled` →
  `setFacetEnabled({skill, targetForm, enabled})` (it replaced `setLearningMode`): enable upserts
  the facet and clears `disabled_at`; disable sets it; a real flip resets that facet's leech state.

### Pronunciation facet (citation + per-form)

`(pronunciation, <form>)` is a recognition-mode facet (passive queue, own schedule, counts toward
the recognition budget) drilling how the target *sounds* — `''` for the headword, a non-empty
`target_form` for a specific inflection. Enabled from the Study-targets control alongside
Recognition/Production (both citation and form targets).

- **Citation readiness gate** — offerable only when the term has a displayable IPA
  (`hasDisplayableIpa(grammar.ipa, lang)` in `packages/core/utils/pick-ipa`, dialect-independent).
  The chip is greyed ("No pronunciation data yet") when none exists; the backend defends an
  IPA-less enable by deleting the just-created facet (`reconcilePronunciationFacet`). LLM IPA is
  now generated by default at term creation (basic-data pass → `grammar.ipa`, grounding
  overwrites with Wiktionary's), so the gate passes for most terms. This gate applies to
  EXISTING terms (study-targets control); the save-time Study options popovers (web gloss
  sheets + extension tooltip) do NOT pre-gate pronunciation — their preview IPA is a
  Wiktionary-only lookup that says nothing about the IPA enrichment will generate, so the
  checkbox is always offerable there and the backend reconcile is the only defense.
- **Form readiness gate** — a pronunciation form facet is born `pending_data` and flips to
  `ready` only when its payload carries displayable `grammar.ipa`: the Opus form-data pass
  returns `'failed'` without a confident form IPA (no `setFacetPayload`), the study-intent
  sibling copy skips IPA-less payloads, and `setFacetEnabled`'s born-ready heuristic is
  skill-aware (pronunciation keys on `payload.grammar.ipa`, not the `translation` key).
  **Generated form IPA serves without user confirmation** (no confirm-gate); the front-end retry
  chip and per-field provenance/manual edit are the correction paths.
- **IPA-vanished → delete** (citation only, decided over rehab): a citation pronunciation card
  derives its back from `grammar.ipa` at render; if a later grammar edit removes the IPA, the
  facet is hard-deleted (`chunks.updateContent` → `reconcilePronunciationFacet` → `deleteFacet`).
  There is nothing to rehab a soundless pronunciation with, so disable-keeps-history doesn't
  apply here. Form pronunciation needs no delete sync: without IPA it never reaches `ready`.
- **Card** (`flashcard-face.tsx`, dedicated body, not the slot resolver): front = target (ru
  stress hidden) + an audio cue (`Volume2` + "Say it out loud"; the chip is a prompt — there is no
  audio playback); back = stressed display + IPA (`pickIpaForDisplay`, falls back across dialects so a
  card that passed the gate never reveals an empty back). Form-aware: a form card reads its own
  `facetPayload` (`grammar.display_form || form`, payload `grammar.ipa` — never the lemma's);
  citation reads the lemma row. Citation backs show the blue `BadgeCheck` when
  `ReviewTerm.ipaSource === 'wiktionary'` (server-computed: grounded + `grammar.ipa` still
  matches `grounding_patch.ipa`); form cards never badge. Self-graded, passive pool.
- Citation payload is `{}` — IPA is derived at render from `grammar.ipa`, so grammar edits stay
  live. A form facet's payload carries its own `grammar.ipa` bag (dialect-split languages → the user's dialect
  bucket, others → `untagged`).

### Form facets

A `(meaning_recognition | meaning_production, '<form>')` facet drills a **specific inflection** of
a term (e.g. `(meaning_recognition, 'стола')`) on its own independent schedule. `grammar.studied_form`
stays as a write-only generation artifact; its never-overwrite gate is **form-facet existence**
(`hasFormFacet`).

- **Key normalization** — `target_form` is normalized on every write path by
  `normalizeTargetForm(text)` (`packages/core/utils/normalize-target-form.ts`: NFC → strip
  combining acute U+0301 → trim → lowercase) so `стола`/`стола́`/`Houses`/`houses` collapse to one
  key. NFC runs before the strip so orthographic acutes arriving decomposed compose and survive
  (NFD `más` keys as `más`, never colliding with `mas`); a U+0301 that survives NFC has no
  precomposed form — a Russian-style stress mark — and is stripped. The SQL twin
  (`lower(trim(regexp_replace(normalize(form, NFC), chr(769), '', 'g')))`) is pinned
  byte-for-byte in the repository queries. `payload` keeps the **full
  display form** (stress/case intact); only the key folds. This is **not** the display
  `stripStressMarks` helper (which preserves case for the front render).
- **payload** = the form's own full card content (`FormFacetPayloadSchema`: `form`, plus optional
  `translation`, `definition`, `targetExample`, `nativeExample`, and a `grammar` subset). The form
  swaps into the `headword` slot (front on a recognition card, back on a production card); the rest
  feeds the same meaning layouts. `resolveCardContent` (`practice/utils`) prefers the form payload
  per field and falls back to the lemma where the form is silent — **except IPA, which never falls
  back** (a lemma's transcription is wrong for the inflection). The lemma is demoted to a secondary
  back line. No `getCardFaceConfig` change. The payload merges shallowly server-side (`payload ||
  $new`), so writers must send `grammar` **complete** (the merge replaces the whole sub-object).
- **generate-and-confirm** — a form added from the "+ Add a form" picker is born
  `data_status='pending_data'` (enabled but **not** queued; the queue filters `data_status='ready'`)
  carrying only the surface string. The editor body offers **Generate** (a focused **Opus** pass,
  `generate-form-data.ts` → `generateFormFacetData` → `setFacetPayload`, synchronous, user behind a
  spinner — never the Haiku gloss) or **Enter manually**; either fills the payload and flips to
  `ready`, after which the full editable field set replaces the affordance. The generate path also
  snapshots what it wrote into the server-write-only `generated_payload` column (the public
  `setFacetPayload` contract never carries it); the editor's per-field provenance indicators compare
  the live payload against it — diverged = "Edited" pencil with a one-tap revert. Manual entry
  leaves it null: no snapshot, no provenance claims. Generation emits
  translation / definition / example / pos / **the form's own IPA** (omit-when-unconfident, backed
  by the pronunciation readiness gate) and **source-seeds** the `targetExample` from the form's
  encountered sentence (`facet.source`) — Opus translates that rather than inventing. Enabling
  Production on an already-filled form reuses its payload and is born `ready` (the `translation`
  key signals "data provided"). Per-form **pronunciation** is a real toggle: with a sibling
  payload carrying `grammar.ipa` it is born ready off that payload; otherwise it goes
  `pending_data` → the same generate/retry chip (see §pronunciation's form readiness gate).
- **Candidates** — "+ Add a form" sources encountered forms from
  `listCandidateFormsForChunk` (distinct kept-card `surface_form`, minus the lemma and any
  already-faceted form), surfaced on demand, not auto-added.

## 2. The scheduler (fsrs.ts)

Thin wrapper around `ts-fsrs`, with one instance **per pool**: production uses library
defaults (`request_retention` 0.9), recognition schedules at `request_retention: 0.8`
(`RECOGNITION_REQUEST_RETENTION`) — ~2.4× longer intervals for the same card. Recognition is
the default pool every kept term lands in and terms are cheap to add, so it accepts ~80%
recall to keep the review load down; production keeps the tighter default because active
recall is the skill worth drilling. Retention only stretches the due-date mapping —
stability/difficulty math is identical — and the higher lapse rate it implies is absorbed by
recognition's higher leech threshold (§7). Both instances have `enable_fuzz: true`; all other
parameters are library defaults. App ratings `again | hard | good | easy` map 1:1 to FSRS
grades. States mirror FSRS: `new`, `learning`, `review`, `relearning` (plus DB `NULL` = not
introduced).

`applyRating(facetRow, rating, now)`:

1. Reads the facet's FSRS columns into an FSRS card; a never-reviewed facet is seeded with
   `createEmptyCard(now)`. The columns include `srs_learning_steps` — ts-fsrs v5's per-card
   position on the intraday learning/relearning ladder (defaults: learning `1m → 10m`,
   relearning `10m`). The counter MUST round-trip through the DB: `good` graduates a
   learning card to `review` only from the ladder's last step, so rebuilding it as 0 on
   every read would trap cards in `learning` forever (the only exits would be `easy` and
   gate graduation).
2. Runs `fsrs.next()` and persists
   `state/due/stability/difficulty/last_review/reps/lapses/learning_steps` on the facet
   (`applyFsrsResultForFacet`). The undo snapshot (`prev_srs_*` on the rating event) carries
   the counter too, and leech/warm-up graduation (`unparkAndSoftReentryFacet`) resets it to 0
   so a later lapse starts the relearning ladder from its first step.
3. **Recognition 24h floor**: for recognition-mode facets (`reviewModeForSkill(skill) ===
   'recognition'` — i.e. `meaning_recognition` and `pronunciation`),
   non-`again` ratings clamp `due` to at least `now + 24h`. This kills FSRS's minutes-away
   intraday steps for correct answers — finishing a session leaves nothing immediately due.
   `again` is deliberately NOT clamped, so an abandoned miss stays due soon. Production facets
   are never clamped.

Practical effect of the floor: a passive card you get right never comes back the same day; a
card you fail goes to `learning`/`relearning` with a short FSRS step and is served as a
budget-exempt follow-up (see §4).

### State lifecycle quirk: `'new'`

The passive introduction guard (§5) stamps the row `srs_state = 'new'`, due now, in its own
transaction *before* the FSRS write overwrites it with the rating result. Normally invisible;
if the FSRS transaction fails the row survives as `'new'`/due-now and self-heals on the next
rating. This is why `'new'` is grouped with `'review'` everywhere (queue bucket, budget
predicate).

## 3. Daily limits (per language)

`practice_max_new_terms` / `practice_max_review_terms` live on
`user_target_language_prefs` (Languages settings screen) and are the **recognition-mode**
caps. Defaults 20/100; hard maxes 100/300; missing row ⇒ defaults. `clampPracticeSessionLimits`
clamps to [0, hard-max] and treats **both-zero as "fall back to defaults"** — a fully-paused
language is deliberately not expressible (the contract also rejects both-zero with a sum>0
refine; the settings UI snaps invalid drafts back on blur).

Review caps are **per review mode** (recognition / production). Production gets an
optional **review** cap only — `practice_max_review_terms_active` (nullable; **NULL = uncapped
= hard ceiling**, the default). The **new** budget is language-level and COMBINED: both pools'
citation facets consume the one `practice_max_new_terms` allowance
(`isDailyNewCappedFacet` = either citation skill; a both-pools term consumes two slots — the
budget counts *introductions*, not terms). The settings UI (`cefr-per-language-list.tsx`)
surfaces it as a language-level "New introductions per day" input, plus a Recognition group
{Review} and a Production group {Review only}, where an empty Production-review input means
uncapped (NULL).

**Production-first is a per-session rule, not a daily reservation**: within one
composed/warm-up session production is planned and served before recognition, but across a day whichever
path introduces first (a direct rating or a displayed onboarding gate) consumes budget in event order —
deliberately, since a global priority would need cross-surface coordination for little gain.

Daily budgets:

- **New budget** (combined, both pools) = limit − count of citation facets (either pool) with
  `introduced_at` = today. Consumed by introductions (first citation-facet rating or warm-up
  park), from flashcards and warm-up. All capped guards compare against the same
  combined-count subquery under one advisory lock key
  (`flashcards:{userId}:{targetLanguage}`), so two pools introducing concurrently can't both
  pass the count.
- **Review budget** = limit − `COUNT(DISTINCT (user_lookup_id, skill, target_form))` of today's
  `practice_rating_events` where `skill = ANY(<mode's skills>)`, `was_introduction=false`,
  `prev_srs_state IN ('new','review')`, `reverted_at IS NULL`. Counting **distinct facets**
  (not terms) means caveat-meaning + caveat-pronunciation are two slots, while in-session
  `again` redrills of one facet charge one. The mode's skills: recognition =
  `{meaning_recognition, pronunciation}`, production = `{meaning_production}`. Counting events
  (not queue state) is what fixed the "refresh refills the queue" bug.

**Learning/relearning follow-ups are exempt from both budgets.** A card in
`learning`/`relearning` state is an unfinished intraday step (usually a failed card); it is
served regardless of spent/zero budgets so it can never be stranded. Only the hard max (300)
caps it. *Consequence: setting review-limit 0 does not silence a language that has pending
learning-state cards — they keep appearing under "Follow-ups" until cleared.*

## 4. Flashcard selection (listDueReviewTerms, listOptInNewFacets)

Two repository selectors feed the composed queue's flashcards. Both serve the pool's **skill
set** (passive = `{meaning_recognition, pronunciation}`, active = `{meaning_production}`),
filtered to enabled (`disabled_at IS NULL`), ready (`data_status='ready'`), non-parked facets:

| selector | predicate | cap | order |
|---|---|---|---|
| `listDueReviewTerms` review-state | `srs_state IN ('new','review')`, due | remaining **review budget** (`resolveReviewCaps`) | due ASC |
| `listDueReviewTerms` learning-state | `srs_state IN ('learning','relearning')`, due | hard max only | due ASC |
| `listOptInNewFacets` | `srs_state IS NULL`, **NOT** primary citation, not decayed | `includeOptInNew` only; `MAX_OPT_IN_NEW_PER_SESSION` across pools, hard ceiling per pool under `new_only` | tier ASC, zipf DESC |

Citation-new terms never come through either selector: they enter via warm-up gates
(`listEligibleNewCitationFacets` → the composed queue's planned introductions, §4b).

**New-term priority tiers** (`new-term-priority.ts` — the single home of the constants and
SQL fragments). Warm-up discovery, `Up next`, and the opt-in selector order by a computed tier, then `zipf_estimate DESC NULLS
LAST` (most-frequent first; NULL = not yet estimated), then the old `created_at ASC` FIFO as
the stable tiebreak, closed by `headword ASC, sense ASC, id ASC` so the ordering is strictly
unique. With a pinned book, the recognition order interleaves the book stream on top of
this (see **Pinned book** below). The Vocabulary tab's `Up next` filter pages that final
order with a keyset cursor, so the list a user inspects there is the introduction order.
The tier, from three signal columns on `user_lookups`:

1. **revealed demand** — `encounter_count >= 2`: the term was encountered again at a
   user-intent boundary (a re-save, or a lesson import confirming it as a duplicate).
2. **fresh saves** — `last_encountered_at` within the 14-day freshness window, **and**
   `zipf_estimate >= FRESH_SAVE_MIN_ZIPF` (3.5) or not yet estimated. A rarer fresh save
   gets no boost: it waits in the backlog (at its zipf position, so near the tail) until
   a second encounter lifts it to tier 1. Cheap binge-saves of rare words therefore can't
   crowd out more frequent backlog terms. The floor was tuned on prod saves: the LLM
   estimates run high, and 3.5 demotes about a fifth of them.
3. **the backlog** — everything else, served most-frequent-first via `zipf_estimate`
   (LLM-estimated continuous Zipf, 0–8 one decimal, emitted by the basic-data pass;
   NULL — not yet estimated — sorts last).

Signals are maintained by `recordEncounter` (user-lookups repository), called only at
user-intent boundaries — highlight-save enrichment, lesson-import confirm, and an explicit
lookup of an already-saved term — with a 1-hour collapse window so worker retries /
multi-chunk runs can never inflate a single save into tier 1. The window runs on
`last_demand_at`, a clock only these demand writes stamp (creation defaults it to NOW()):
checkpoint content encounters bump `last_encountered_at` but must not swallow a re-save or
lookup made within the hour. `findOrCreate` never bumps them (it fires from background
materialization).

**Lookups as demand** (`glosses.recordLookup`, `service/lemma-lookups/record-lookup.ts`).
An explicit lookup is a tap that opens a gloss sheet (web reader preview, practice
LookupSheet) or the pointer pinning an extension hover gloss; a bare hover never records.
Single-word selections in `KAIKKI_LANGUAGES` only: the token resolves through the
checkpoint matcher plus the homograph guard (`applyFrequencyAsymmetryGuard`), and each
surviving lemma gets a collapsed episode in `lemma_lookups` (same 1-hour window). If the
user already saved a term whose `user_headword_lemma_keys` contain the lemma, the episode
goes straight to that term (`recordEncounter`) and the lemma's `credited_count` watermark
advances. Otherwise it waits: every save path (highlight enrichment, adhoc, lesson-confirm
duplicates) calls `creditLookupDemand`, which adds the uncredited episodes (max over the
term's keys, minus the latest one when it is inside the collapse window — that lookup led
to this save) to `encounter_count` and advances the watermark, so retries and re-saves
never count an episode twice. A word looked up on two earlier days and saved today starts
at tier 1. Combined with the tier-2 Zipf floor, rare words need a second piece of
evidence — a re-save, a repeated lookup, or a lesson confirm — before they outrank the
backlog.

**Pinned book** (`book-priority.ts`, `book-quota.ts`; pin endpoints on the `books`
router). A user can pin one book per language (`book_pins`). While it's pinned,
never-introduced **recognition** terms that occur often in its **unread** parts form a
book stream that gets up to `BOOK_NEW_SHARE` (0.5) of the combined daily new budget. It
reallocates the existing budget and never adds to it. Everything is computed live at
queue time, so pinning, unpinning and reading take effect on the next fetch with no
backfill.

- **Occurrences ahead.** Per-part counts come from `book_part_lemma_counts.occurrences`
  (the profile build, homograph-guarded, every surviving reading credited; docs/DATA-MODEL.md). The anchor is the **furthest-reached
  part**: the highest `book_part_index` among the book's live sessions with a
  `furthest_read_segment_index`. Rereading an early chapter never re-inflates "ahead".
  - That part counts pro-rated by what's left of it, `1 − (furthest + 1) / segments`.
  - Later parts count fully; earlier parts don't count at all.
  - A term's `ahead` is the max over its `user_headword_lemma_keys`. Summing would
    double-count the liberal reflexive strips.
  - Before any reading, the whole book is ahead.
- **Membership.** `ahead ≥ MIN_BOOK_OCCURRENCES_AHEAD` (3) and **no enabled production
  citation facet**: production-marked words keep their own ordering. Membership is by
  occurrences, not provenance, so a word saved from an article that recurs in the book
  counts — including recognition cards created from the book page's "Learn before you
  read" list (docs/READER-SPEC.md), whose ≥ 3 threshold on primary occurrences guarantees
  membership while the book is pinned. Multi-word headwords never match single-token
  counts. The 90-day decay still applies.
- **Quota.** `book_quota = ceil(0.5 × daily max)`. Usage is the count of citation facets
  introduced today with `book_quota_source_id` set. **Both introduction guards** stamp that
  column, at introduction time, with the pinned book when the term is in its stream
  (`bookStreamSourceForTermSql`):
  - the warm-up park guard, which Learn extra also goes through;
  - the rating/reading guard.

  Undo of an introduction clears the stamp. Because the stamp is durable, replacing the
  pin mid-day or reading past a word's last occurrence never refills the quota.
- **Order** (`introductionOrderCtesSql`, one builder for every consumer). The population
  is the `Up next` stage. **Master** rows are the introduction candidates (no live
  production sibling). Among them:
  - the first `remaining` book-stream terms by `ahead DESC` are **boosted**, at fair-share
    positions `k / 0.5`;
  - every other master row is **normal**, at `j / 0.5` in `newTermOrderSql` order.

  Ties go to the book, so the order reads B N B N…. Book terms past the quota are simply
  normal rows. Non-master rows (bridge-pending, listed only by `Up next`) are slotted
  immediately before the next normal row in tier order and take no position, so filtering
  them out of any consumer yields discovery's order exactly. Interleaving, rather than
  book-first, matters because production is allocated first from the shared budget: a
  busy production day leaves recognition fewer slots, and the book still gets only half
  of them, so it can't starve the normal stream. With no pin, or no quota left, the order
  equals the tier order.
- **Consumers.**
  - `listEligibleNewCitationFacets` (recognition; production keeps the tier order).
  - `Up next`: cursor `(pos, lane, seq, id)`, and boosted rows carry
    `pinnedBookPriority` for the row's "Book" badge. Positions are recomputed per
    request, so an introduction between page loads can shift them.
  - The planner is unchanged: it still takes each ordered list's head.
- **Unpin / finish / remove.**
  - Unpin deletes the row, and unstarted book words fall back to their tier position on
    the next fetch. Introduced words keep their schedules, and parked onboarding gates
    stay.
  - Finishing writes nothing: `ahead` reaches 0 by itself.
  - `books.remove` deletes the pin in the same transaction as the session soft-delete,
    since the source row survives for dedup.

**Decay (virtual shelf)**: never-introduced terms with `last_encountered_at` older than 90
days are excluded from the opt-in selector, from warm-up discovery
(`listEligibleNewCitationFacets`), **and from the matching landing counts** (`new_count`,
`production_new_count`, the opt-in counts) — the badges must not advertise terms the queue
refuses to serve. Decayed terms stay visible in the Vocabulary list (`unseen` status) and any
re-save revives them (`recordEncounter` refreshes `last_encountered_at`). Deliberately
OUTSIDE the decay predicate: due/learning selection, `listParkedTerms`, and the
leech-rehab/warm-up surfaces — parked terms have their own lifecycle (`leech_parked_at ASC`
ordering, rehab graduation) and must not silently decay. All predicates are `NOW()`-relative,
so `pnpm db:advance-day` time travel works.

The **primary citation** facet is the pool's daily-new-capped card (passive →
`(meaning_recognition,'')`, active → `(meaning_production,'')`; both draw on the one
combined budget). A recognition primary-citation card is additionally excluded — from
warm-up discovery, `new_count`, AND the introduction write gates — when the
term's enabled production citation facet is **live** (scheduled or parked): such terms get
their recognition schedule from the production→recognition bridge instead (§7). **Opt-in
new** facets
(pronunciation/forms) bypass the daily-new cap and are served **only** by the composed
queue's `includeOptInNew` pass — on by default, so the primary Practice button introduces
them, paced per compose so an enabled backlog can't flood a session (§4b).

**Sibling spacing** (`listDueReviewTerms`): a term's facets ("siblings") must not be adjacent. Each selected facet is
ranked within its term by priority (due-review > intraday-learning) via `ROW_NUMBER()
OVER (PARTITION BY user_lookup_id …)`; the outer queue orders by that rank first, so every
term's rank-1 facet precedes any rank-2. Best-effort: a term dominating the due set has no
separators left for its high-rank siblings, which go adjacent at the tail (accepted, not a
guarantee). For a term with only its citation facet the rank is always 1, so the order collapses
to plain due-time ordering.

Excluded everywhere: parked facets (`leech_parked_at IS NOT NULL`).

**Over-cap learning**: the ONLY past-the-cap path is the composed queue's **Learn
extra** (§4b) — an explicit batch whose display-time claims pass `bypassCap` to the
warm-up park guard (introductions still stamp `introduced_at`, so they count toward
today). The rating path has no cap bypass.

## 4b. The composed queue (composePracticeQueue)

The primary **Practice** button serves ONE heterogeneous queue — gate exercises for
parked terms (warm-up + rehab) interleaved with due flashcards — built by
`composePracticeQueue` (`compose-practice-queue.ts`). Planned citation introductions and
parked terms render as gate exercises; due/graduated terms and never-reviewed opt-in
facets render as flashcards. The filter spec
(`pools / scope / render / autoWarmup / includeOptInNew / learnExtraCount`, contract
`PracticeQueueFilterSchema`) only selects which populations participate; the Custom
practice presets are just named filter specs.

**Plan/compose/claim split.** All selection and budget arithmetic lives in `planPracticeQueue`
(`plan-practice-queue.ts`): the daily-budget numbers, the introduction budget, the
sequential production-first introduction allocation, the cross-pool gate head-slice, the
exact due-row fetch, the paced opt-in-new slice, the learn-extra slice, and the predicted `dailyLimitReached` /
`canLearnExtra` flags. `composePracticeQueue` materializes it (exercise fetch and optional
bank warming) without changing SRS state; the read-only `previewPracticeQueue` endpoint (GET
`/practice/queue/preview`, input `{targetLanguage}` only — always the default filter)
returns the plan's counts for the landing's session-plan card. One function computes
both, so the plan card and the session chips cannot disagree. Each served queue item
carries **`isNewIntroduction`** (exercise items): true for a planned onboarding gate —
the client's "New" chip bucket, vs "Warm-up" for already-parked backlog gates.
`dailyLimitReached` is forward-looking: the plan would exhaust the budget while candidates
remain. A display-time claim can additionally hit the cap after a concurrent race;
**`canLearnExtra`** (recognition intro candidates remain beyond the planned introductions)
gates the Learn-extra CTA, which
additionally requires `autoWarmup && scope !== 'due_only'` client-side.

- **Planned introductions + display-time claim.** With `autoWarmup` on (the default
  Practice), composition includes eligible never-reviewed citation terms as onboarding
  gates — discovery is by (user, language) via `listEligibleNewCitationFacets`
  (tier-ordered, decayed terms excluded — see §4; recognition candidates also exclude terms
  whose production citation facet is live — the bridge covers those, see §7).
  **Production is allocated first**, then
  recognition, under the COMBINED daily budget. The per-compose budget is
  `min(MAX_WARMUP_INTRO_PER_SESSION, remaining daily budget)` — deliberately NOT coupled
  to the gate backlog (a full warm-up pipeline must not silently starve introductions);
  planned gates serve ON TOP of the backlog slice. Immediately before a planned gate is
  displayed, `claimPracticeIntroduction` calls the atomic
  `initializeAndParkCitationFacetIfUnderDailyCap` guard; only then are `introduced_at`
  and `leech_parked_at` stamped. Closing before reaching it therefore consumes no budget.
  A cap race removes the item and shows the limit notice. There are **no new
  citation flashcards** — new terms enter via ~3 gate-days, then graduate (soft
  re-entry).
- **Serve pass**, production-first (`prod flashcards → prod gates → recog flashcards →
  recog gates → opt-in-new` — pure concatenation of deterministic sub-lists, a stable
  one-shot snapshot). Due flashcards come from `listDueReviewTerms` and opt-in flashcards
  from `listOptInNewFacets`, so **citation-new contributes 0 flashcard rows**. Gates come from `getStrengthenExercises` over a pre-sliced id set:
  `listParkedTerms(excludeCreditedToday: true)` — a term whose rehab day-credit was
  already earned today is **excluded** (answering it would consume a banked exercise
  while advancing nothing) — oldest-parked first, capped at `MAX_GATES_PER_COMPOSE`
  (which also bounds `ensureExerciseBank` fan-out per call). **Both parked origins serve
  together**: an onboarding gate is committed due work exactly like a rehab gate, so a
  daily Practice habit graduates warm-up terms as a side effect (no stranded lane).
- **Scopes.** `due_only` skips planned introductions and opt-in-new but
  serves gates of both origins; `new_only` skips due flashcards and restricts gates to
  onboarding-parked terms.
- **Opt-in-new pass** (`includeOptInNew`, default on): never-reviewed pronunciation/form
  facets served as flashcards — they never park (the exercise bank has no facet
  identity), so this is their ONLY introduction path. The planner selects them
  (`PoolQueuePlan.optInNewRows`), so the preview's `new` count includes them. Pacing:
  `MAX_OPT_IN_NEW_PER_SESSION` (5) across both pools, production first; under
  `new_only` (the Learn-new preset) each pool takes up to `HARD_MAX_PRACTICE_NEW_TERMS`.
  Every preset except the due-only and exercises-only ones (where the pass is inert)
  includes them.
- **Learn extra** (`learnExtraCount`, 1–20): an explicit batch past the daily-new cap —
  those planned items carry `bypassDailyCap`, applied by the same display-time claim
  (skips only the count predicate; `introduced_at` still stamps, so extras count toward
  today). Offered as a one-tap on the composed completion screen when the cap was hit; carried as mutation
  input, never a URL param, so refresh/back can't replay the bypass.
- **Hint pre-warm.** The initial compose request also fire-and-forgets hint-exercise generation
  for served flashcard terms whose bank has no hint-type slot (see §7 "Flashcard hints"),
  so the Hint button is usually live by the time its card comes up.
- **Refresh** (`refreshPracticeQueue`) recomposes the same filter read-only and never
  warms hint banks — safe to poll; retaining `learnExtraCount` keeps an explicit batch
  stable. The client uses it only to swap `generating` exercise placeholders to
  `ready`/`failed` in place (keyed `(pool, userLookupId)`), never to append.

The composed queue is the only flashcard surface. The post-session Strengthen CTA remains a
dedicated surface. The session-scoped warm-up (`/practice/warmup/$lang`) still exists
but has no UI entry point — the session-vocabulary footer now launches the zero-SRS
session recap quiz instead (client-side, no FSRS writes; see docs/REVIEW-SPEC.md), leaving the
composed queue's display-time claims as the sole warm-up on-ramp.

## 5. Rating flow (applyTermRating)

Shared by flashcards (`rateTerm`), checkpoint credits, and lesson-import lapses. Per rating:

1. **Refusals (no FSRS, no event)**: `not_in_active_pool`; parked term (stale queue/tab —
   accepted as a no-op); introduction over the daily cap.
2. **Introduction guard** (passive, state-NULL only): `initializeCitationFacetIfUnderDailyCap`
   runs in its own advisory-lock transaction — atomically counts today's introductions
   against the *full clamped per-language cap* and stamps `srs_state='new'` +
   `introduced_at` only if under it. There is no cap bypass on this path (Learn extra
   bypasses on the parking side instead). Active introductions initialize unconditionally.
3. **FSRS write + event log in one transaction**: `applyFsrsResultForFacet` and the
   `practice_rating_events` insert commit together. The event carries the rated **facet
   identity** (`skill`, `target_form`) alongside `pool` (the session queue — distinct
   namespaces), the **pre-rating SRS snapshot** (`prev_srs_*`), `was_explicit` (false =
   an implicit rating — checkpoint credit or lesson-import lapse), `was_introduction`,
   `caused_parking`, and a
   `reverted_at` tombstone column — the foundation for undo and the review-budget count.
   Append-only; every event row represents an applied write.

Both `rateTerm` and `undoRating` validate the **legal `(pool, skill)` pairing** first (passive
↔ {recognition, pronunciation}; active ↔ production) — a crafted mismatch is a 400.
4. **Post-commit, fire-and-forget**: `parkLeech` (if the rating crossed the leech threshold)
   and `warmExerciseBank` (on parked / `again` / `hard` — pre-generates Strengthen
   exercises). A crash window can leave `caused_parking=true` without the park applied
   (accepted; un-parking an unparked term is a no-op — and undo's restore also clears it).

`rateTerm` resolves the per-language new-cap itself after loading the lookup row (the row
carries `target_language`) — for both pools, since the citation intros share one budget.

### Undo (undoRating)

`rateTerm` returns the logged event's id as `eventId` — **null exactly when nothing was
applied** (daily-cap refusal, or the parked stale-queue no-op; this disambiguates the two
`parked: true` response shapes — a rating that newly parked a leech carries an eventId and
is fully undoable). `practice.undoRating` takes that handle and, in one transaction:

1. Locks the **latest live** (`reverted_at IS NULL`) event for the **facet**
   (user, lookup, skill, target_form) — `FOR UPDATE` serializes concurrent undos. Keyed on
   facet identity, **not pool**: the passive queue can serve multiple facets per term, so pool
   would address the wrong card. If the passed eventId isn't that event (a later rating landed
   from another tab, or it's already reverted), the undo is a stale-safe no-op:
   `{ undone: false }` (200), **never an error** — only the latest event's snapshot describes
   the row's current state, so an older one must never restore.
2. Restores the facet's SRS family from the event's `prev_srs_*` snapshot
   (`restoreSrsSnapshotForFacet` — nullable on purpose: an undone *introduction* restores
   state back to NULL and clears `introduced_at`, refunding the daily-new slot;
   `caused_parking` additionally un-parks and zeroes the facet's rehab columns).
3. Stamps `reverted_at`. The review budget refunds itself — every budget query filters
   `reverted_at IS NULL`.

No FSRS recompute and no exercise-bank warming: the only caller (flashcard re-rate)
immediately follows a successful undo with a fresh `rateTerm`, which re-runs all of that.
**Re-rate = undo + fresh rate** (Anki semantics), so the new rating goes through the full
cap/introduction/leech machinery.

## 6b. Checkpoint reviews (real sessions)

Implicit reviews from real sessions (movies, texts, YouTube): an explicit checkpoint press — the reader-footer "I've followed up to
here" button, or the extension overlay's checkpoint button — credits an implicit
`good` to every saved term appearing in the newly-read span whose recognition
facet is review-state and due. **Nothing is ever credited automatically**;
skimming or rewatching changes nothing. Service:
`apps/backend/src/service/checkpoint/`; endpoints live on the study-sessions
contract (`getCheckpointPreview` / `collectCheckpoint` / `undoCheckpoint`).

- **Pointer.** `study_sessions.reviewed_until_segment_index` — monotonic, NULL
  until the first press, parallel to `furthest_read_segment_index` (which stays
  a pure scroll tracker). Each press credits only the span
  `(reviewed_until, toSegmentIndex]`; the server clamps `toSegmentIndex` to the
  track's real max index. Undo is the only non-monotonic write (exact restore,
  including NULL for a first checkpoint).
- **Language gate.** Hard-gated to `KAIKKI_LANGUAGES` (loaded wiktionary
  dumps — ru/en/de/es/pt/fr today). No degraded fallback: collect returns
  UNPROCESSABLE_ENTITY (`UNSUPPORTED_LANGUAGE`), preview reports
  `supported: false`, and the UI hides the affordances.
- **Matching.** Span segments tokenize server-side with the same
  `Intl.Segmenter` wrapper the reader uses; both sides of every comparison fold
  through `checkpoint_fold` / `foldCheckpointToken` (byte-pinned twins — see
  `docs/DATA-MODEL.md`). The tokenizer skips word ranges immediately preceded
  by digit+hyphen (ASCII or typographic U+2010–U+2015): the letter part of
  «27-летний» / de «27-jährige» is a compound piece, not an occurrence of the
  standalone word. Selection folding (`foldSelectionTokens`, the suppression
  input) is deliberately NOT guarded — broader suppression is strictly
  conservative. Tokens resolve to real-lemma headwords through three
  arms (inflected-form join, direct headword hit, stub redirects); the user's
  vocab folds via `foldUserHeadwordCandidates` (en strips leading `to `, de
  `sich `, fr `se ` — fr's elided shape `s'appeler` needs no rule because the
  fold's clitic strip already reduces it) and intersects with the span's
  lemma set. Ambiguous forms credit every saved candidate, AFTER a
  frequency-asymmetry guard (`applyFrequencyAsymmetryGuard`) prunes homograph
  liabilities from the resolved edges: for a token resolving to 2+ lemmas, a
  non-identity reading (token ≠ lemma headword) at least
  `HOMOGRAPH_RANK_FACTOR` (50)× rarer by `lemma_ranks` rank than the token's
  best reading is dropped, unless the lemma itself is common
  (`NEVER_DROP_RANK` 3000 — protects fr `suivre` behind `suis`) — this kills
  «при»→«переть»-class edges for every lane, suppression, MWE recall, and the
  preview alike; identity edges never drop (fr `été` behind `être`), and a
  token with no ranked reading keeps everything (languages without built
  ranks no-op). When the user holds 2+ saved senses of one matched
  headword, a Haiku pass (`checkpointSensePass`) picks the sense used — before
  lane partitioning, so a rejected sense can neither credit nor surface as
  backlog; a pass failure drops those headwords (conservative).
- **Multi-word expressions** can't single-token match, and contiguous n-gram
  matching structurally misses separable verbs, free word order, and
  interruptions — so MWEs run two stages instead. (1) Liberal recall filter
  (`findMweCandidates`): the saved headword splits into folded content lemmas
  (per-language particles dropped — en `to`, de `sich`, fr articles /
  prepositions / `se` / `que` / `ne`; French also treats hyphenated headwords
  as MWEs and splits on hyphens — `peut-être` tokenizes apart, so its hyphen
  parts are the only matchable units — with each part re-folded so interior
  elisions reduce, `coup d'état` → `état`); it is a candidate iff
  every content lemma appears within ONE segment, either as a resolved lemma
  of that segment's tokens (inflected occurrences count) or as a raw folded
  token. (2) Haiku confirm (`checkpointMwePass`): judges whether the
  expression actually occurs in the candidate segment (inflected/reordered
  yes; shared words in unrelated roles no); a failed pass or missing verdict
  drops the candidate — never credit on a guess. Confirmed candidates join
  the normal sense-resolution → partition → credit path; the preview counts
  recall-filter candidates optimistically (no LLM on the GET path, part of
  the documented overcount).
- **Lanes** (strength of evidence must match strength of the write):
  - review-state (`new`/`review`), due, enabled, `ready`, unparked → implicit
    `good` (`was_explicit = false`), the same predicate as the review-budget
    count;
  - review-state not due, learning/relearning, disabled, `pending_data`, or
    missing recognition facet → nothing (encounter aggregates only);
  - leech-parked → excluded entirely (weak contextual evidence never overrides
    the rehab loop);
  - never-introduced (`srs_state IS NULL`, incl. onboarding-parked) → offered
    as backlog known-assertion candidates
    (`study_session_checkpoints.backlog_candidate_ids`), excluding terms
    highlighted anywhere in the session or glossed in the span, terms with a
    card in any session of the same content source (earlier parts of the same
    book), and terms whose `last_demand_at` (save, re-save, or explicit
    lookup) is under `BACKLOG_MIN_DEMAND_AGE_DAYS` (7) old — a save is
    evidence the user did NOT know the word, so a reappearance soon after
    can't turn it into a known-assertion (`isBacklogOfferable`). Stored and
    returned capped at 200 (`MAX_BACKLOG_CANDIDATES` — the assert contract's
    max batch, so the claims sheet's single confirm can never exceed it);
    the preview's backlog count is capped to match. Candidates past the cap
    re-surface in any later span they appear in. Capped candidates matched
    ONLY through inflected forms (no matched lemma is itself a span token;
    MWEs are exempt — `checkpointMwePass` already confirmed them) then pass a
    Haiku confirm (`checkpointBacklogPass`, collect-only, chunked internally):
    given headword, saved sense, and up to 3 match-centered occurrence
    windows, it judges whether the word actually occurs with that meaning in
    any of them — the equal-frequency homograph tail the mechanical guard
    can't rank apart. Denied or unverdicted candidates drop from BOTH the
    response and the stored claim set; a pass failure keeps only
    direct-token matches (never offer a known-assertion on a guess). A
    pass-rejected candidate does not free a cap slot (accepted: realistic
    counts sit far below 200). Deliberate residual: a verbatim-headword hit
    whose in-context word is a different same-spelling lexeme (saved «стих»
    "poem" vs «ветер стих») skips the pass — the claims sheet's per-row
    evidence is the mitigation for that class.
- **Suppression, never punishment.** A term glossed (preview glosses included —
  client-tracked `previewedSpans`, since the gloss endpoint is stateless) or
  highlighted inside the span has its credit suppressed — never converted to an
  inferred `hard`/`again`. "Looking is free" must not become "looking is
  punished".
- **Budget.** Checkpoint credits leave `import_batch_id` NULL, so they count
  toward the daily review budget — completed review work replaces that day's
  flashcard load. The budget can never *block* a checkpoint (only the served
  queue is budget-gated). Provenance: `practice_rating_events.study_session_id`
  + `checkpoint_id`.
- **Encounters.** Every matched term (all lanes) gets
  `recordContentEncounter`: bumps `last_encountered_at` (the 90-day new-term
  decay never shelves a term the user just read) plus
  `content_encounter_count` / `last_content_encounter_at`, but NEVER
  `encounter_count` (tier-1 revealed demand stays reserved for deliberate
  re-saves). Not reverted on undo (accepted noise).
- **Concurrency.** The facet row is the serialization point for EVERY SRS
  writer: ratings (`applyTermRating`), checkpoint credits, the undo paths, and
  known-assertions all lock the facet row (`getFacetForUpdate`) inside their
  transaction before reading or restoring it, so concurrent writers chain off
  committed state instead of overwriting each other from stale snapshots.
  Multi-facet lockers acquire locks in one global order (session row first
  where applicable, then facets by `user_lookup_id` asc). For collect:
  matching and the sense pass run outside the write transaction; the
  transaction locks the session pointer (`FOR UPDATE` — mismatch ⇒ 409
  CONFLICT, client refetches and retries), reloads the creditable facets
  under `FOR UPDATE` and re-validates the full predicate on the locked rows
  (a rating that landed during the LLM call skips that facet; one arriving
  later blocks on the row lock), then credits, advances the pointer, and
  records encounters atomically.
- **Undo.** One checkpoint = one batch: only the session's latest LIVE
  checkpoint may be undone (stale ⇒ `{undone:false}` no-op, never an error).
  Undo takes the session lock FIRST (same lock order as collect, so a
  concurrent press can't advance the pointer under the restore), then the
  checkpoint row lock. Per event the facet row is locked and the
  latest-live-event-per-facet invariant re-checked; facets rated again since
  are skipped (partial undo, counts reported). The pointer restores exactly
  (incl. NULL); budgets refund via the `reverted_at` filters.
- **Preview.** `getCheckpointPreview` (GET) powers the footer badge: counts the
  would-be credits/backlog for a span without writing. It cannot see the
  client's previewed-gloss spans and skips every LLM pass (multi-sense, MWE,
  and backlog confirmation all counted optimistically) — a documented slight
  overcount; the collect toast and claims sheet show the real numbers.

## 6c. Backlog known-assertions ("I already know this")

The opt-in second step behind a checkpoint (never on the primary press): the
claims sheet offers the checkpoint's backlog candidates — saved terms whose
recognition facet was never introduced — and one confirm seeds the selected
terms straight into review state. Service:
`apps/backend/src/service/checkpoint/assert-known.ts`; endpoints
`assertKnownBacklog` / `undoKnownAssertions` / `getCheckpointClaims` on the
study-sessions contract.

- **Evidence + per-row selection.** Every candidate carries `matchedSurface`
  (the cased surface form seen in the span; for MWEs the anchor content word —
  the longest content lemma's occurrence, so ru's particle-less split can't
  anchor «в преддверии» on a stray «в») and `context` (a match-centered
  window, ~80 chars each side, cut points snapped to word boundaries with
  ellipses). The sheet bolds the surface inside the context so the user can
  catch a residual false positive, and each row is a toggle (all selected by
  default, deselections keyed to the checkpoint id); the confirm CTA sends
  only the selected subset — the endpoint was always subset-tolerant.
  Evidence persists in `study_session_checkpoints.backlog_evidence` (JSONB,
  `{userLookupId: {surface, context}}`; NULL on pre-evidence rows, every
  reader falls back to null fields).
- **Rehydration across remounts.** The collect response's candidate list
  lives only in client memory, but the ids persist on the checkpoint row —
  `getCheckpointClaims` (GET) re-offers the latest LIVE checkpoint's
  candidates that still pass the assert eligibility (recognition facet never
  introduced, enabled, ready; parked or not) and are still offerable (a save
  or lookup since the checkpoint withdraws the offer), preserving the stored order and
  re-attaching the stored evidence, so
  a reload or navigation can't strand the claims re-entry. Client precedence:
  a local collect/assert/undo this mount overrides the server copy (an
  exhausted batch stays gone while the invalidated query catches up). Earlier
  live checkpoints' leftovers are not re-offered here; they re-surface in
  later spans.
- **Server-authoritative claim set.** Only ids in the checkpoint's stored
  `backlog_candidate_ids` are accepted; unknown ids and facets whose state
  changed since the checkpoint (introduced, leech-parked with history,
  disabled, pending) are counted as `skipped`, never errors. The checkpoint
  must be live (`reverted_at IS NULL`) to assert against.
- **Generous seed.** `knownAssertResult`: review state, due
  `KNOWN_ASSERT_INTERVAL_DAYS` (21) out, stability `KNOWN_ASSERT_STABILITY`
  (10), difficulty `SOFT_REENTRY_DIFFICULTY` — assertion isn't demonstration,
  but the asymmetry favors trusting the user: a wrong claim costs one failed
  verification (relearning → leech machinery); a short seed costs guaranteed
  near-term reviews on every correctly-known term. Written directly via the
  guarded seed methods, never through `applyRating` (no FSRS transition
  exists for a never-introduced facet). reps/lapses stay 0.
- **One action, two write paths** (discriminated by the facet's park state):
  - *never-introduced, unparked* → `seedKnownAssertFacet`; the event logs
    `was_introduction = TRUE` (undo restores `srs_state` NULL; its
    introduced_at-clearing is a harmless no-op — see below);
  - *onboarding-parked* (`srs_state IS NULL AND leech_parked_at IS NOT NULL`)
    → `seedKnownAssertParkedFacet`: the assertion **exits onboarding** —
    unpark + clear both rehab columns + seed. The event logs
    `was_introduction = FALSE`, `caused_unparking = TRUE` and snapshots the
    full prior park state (`prev_leech_parked_at`,
    `prev_leech_rehab_correct_days`, `prev_leech_rehab_last_correct_on` —
    onboarding-parked facets can carry PARTIAL rehab progress from warm-up
    gates), so undo re-parks the EXACT prior state. The park-time
    `introduced_at` is untouched — this is not a second introduction.
- **Never touches the daily-new budget in either direction**: assertions are
  neither refused over the cap nor consume it. Deviation from the
  stamp-and-exclude design: known assertions do NOT stamp `introduced_at` at
  all (mirrors `initializeFacet`'s convention for non-daily-capped
  introductions; the rating event is the historical record). The review
  budget is untouched too — NULL-path events fail its
  `was_introduction = FALSE` filter, parked-path events fail
  `prev_srs_state IN ('new','review')`.
- **Lanes share `checkpoint_id`, discriminated by `was_explicit`** (credits
  FALSE / assertions TRUE) and revert independently: `undoKnownAssertions`
  reverts only the assertion lane, changes no pointer, has no
  latest-checkpoint requirement, and still works after the checkpoint itself
  was undone. Assertions superseded by a later rating are skipped via the
  latest-live-event check.
- **Verification for free**: the seed puts the first review ~3 weeks out and
  checkpoint crediting is due-only, so a same-session checkpoint structurally
  cannot verify its own claim — the verifying evidence is always later and
  independent. The coverage stat's claimed/verified split reads this straight
  off the event log (`listCoverageVocab`): a term counts as verified iff it
  has a live `good`/`easy` event on a meaning skill that is
  explicit-or-checkpoint evidence, where the assertion lane
  (`was_explicit = TRUE AND checkpoint_id IS NOT NULL`) is structurally
  excluded — so neither an assertion, a pronunciation good, nor a
  non-checkpoint implicit rating can flip a term to verified.

## 7. Parking + scaffolded exercises: leech rehab AND warm-up

"Park a term and serve it scaffolded gate exercises until it graduates back into FSRS" is
**one mechanic with two entry triggers**, told apart purely by derivation (no extra column):

- **Leech (rehab):** a term you keep failing — `leech_parked_at IS NOT NULL AND
  srs_state IS NOT NULL` (it lapsed in FSRS, so it has SRS state).
- **Onboarding (warm-up):** a brand-new term introduced exercise-first instead of straight
  into the flashcard queue — `leech_parked_at IS NOT NULL AND srs_state IS NULL` (parked but
  never reviewed). Warms both pools (the citation `meaning_recognition` and `meaning_production`
  facets), per pool. Exact-form facets (`target_form != ''`) are never warmed — the exercise
  bank has no facet identity, so only citation facets can park (see
  `docs/proposals/pronunciation-warmup.md` → "fix Trap 19" for the shared facet-identity
  prerequisite).

`listParkedTerms` / `getStrengthenExercises` take a `parkedOrigin: 'onboarding' | 'leech'`
filter (the `srs_state IS NULL` vs `IS NOT NULL` split) so the two surfaces read disjoint
sets from the same column. Everything below "park" is shared.

### Leech detection + graduation

- **Detection** (`shouldParkLeech`): a rating that *itself causes a new lapse* (an `again` on
  a review-state card) and brings `lapses` to the pool's threshold parks the term — `≥ 6`
  for recognition (`LEECH_LAPSE_THRESHOLD_RECOGNITION`), `≥ 4` for production
  (`LEECH_LAPSE_THRESHOLD_PRODUCTION`). Recognition's bar is higher because it schedules at
  a lower desired retention (§2), which roughly doubles its expected lapse rate. New-lapse
  **delta**, not an absolute check, so graduated high-lapse terms aren't re-parked by
  good/easy ratings. Per pool.
- **Parked** = out of every flashcard queue (both selectors filter on the parked
  column). The
  due-summary aggregates exclude parked rows too, so the landing never claims terms the
  queue refuses to serve. Ratings from stale queues are accepted as no-ops. The flashcard
  client reacts to `rateTerm`'s `parked: true` with a toast ("… keeps tripping you up —
  it's parked for rehab exercises") and skips the in-session `again` requeue for that
  card.
- **Pool move resets production rehab.** A real enable/disable flip of the production
  facet (guarded by `disabled_at IS DISTINCT FROM` the target inside `setFacetEnabled`'s
  transaction) resets that facet's parked/rehab columns — both pool-move surfaces (the
  term view's Study targets control and the Vocabulary tab) get it, while idempotent
  re-enable re-stamps don't wipe progress. Only the production facet resets; the
  recognition facet never changes. Soft-deleting a parked term hides it everywhere via
  the existing `deleted_at` filters; restoring resumes with parked state intact
  (correct — it still needs rehab).
- **Rehab**: parked terms surface as gate exercises — in the daily **composed Practice
  queue** (§4b, uncredited-today terms only) and in the post-session **Strengthen**
  round. One correct gate
  answer per server calendar day advances rehab; **3 distinct days**
  (`LEECH_GRADUATION_DAYS`) graduate the term. Gate type ladder by rehab day: passive
  `mc_cloze → mc_comprehension → mc_cloze`, active `mc_cloze → production_cloze →
  production_cloze` (typed answers tolerate edit distance 1).
- **Graduation** (`unparkAndSoftReentry`): atomic — clears parked/rehab columns and writes a
  *softened* re-entry directly (review state, due +24h, stability 1, difficulty 5), NOT the
  demonstrably-failing pre-park schedule. Deliberately a direct facet write
  (`unparkAndSoftReentryFacet`), not routed through `applyRating`, so the recognition 24h
  floor doesn't interfere. `reps`/`lapses` are preserved; the `parked_at`
  flag, not the lapse count, is the re-park gate. `introduced_at` untouched, so the
  daily-new cap is unaffected. For an
  onboarding facet (reps/lapses 0) this same write IS a freshly-introduced flashcard, so
  warm-up and leech use the identical graduation path.

### Warm-up (exercise-first onboarding)

- **Entry** (`warmup.ts` + the composed queue): the composed **Practice** button
  plans eligible new terms language-wide and claims each at display time (§4b) — the sole
  UI on-ramp. The session-scoped `/practice/warmup/$targetLanguage` route +
  `startWarmupSession` (parks one session's terms explicitly) remain functional but
  unreferenced: the session-vocabulary footer now opens the zero-SRS session recap
  instead (see docs/REVIEW-SPEC.md). Abandoned warm-ups need no dedicated resume surface, since
  the next Practice serves the parked terms' gates anyway.
  `startWarmupSession` parks the session's not-yet-introduced kept terms in two passes —
  one per pool, both through the skill-aware `runParkingPass` (`warmup-parking.ts`) and the
  **atomic** `initializeAndParkCitationFacetIfUnderDailyCap` (stamps `introduced_at` AND
  `leech_parked_at` in one tx, leaves `srs_state` NULL — so a crash can't leave a term
  introduced-but-unparked; returns `'scaffolded' | 'cap_reached' | 'not_eligible'`, the
  first cap hit stopping that pass, `not_eligible` skipped). Both pools consume the
  COMBINED daily budget; either pass's cap hit flags `dailyLimitReached`, and neither pass
  inherits the other's stop (the shared guard refuses over-budget entries per candidate
  anyway). The served queue is **production-first mixed**; each
  `StrengthenExerciseEntry` carries its `pool` so the
  client merges placeholders by `(pool, userLookupId)` (a both-skills term has one entry per
  pool with the same id) and its `origin` (`onboarding`/`leech`, derived from `srs_state`)
  so mixed-origin queues pick the right copy; `submitExerciseAnswer` routes to the right
  facet.
- Warm-up entry consumes the **same combined daily new-term budget** as flashcard
  introductions, in both pools — over-cap terms wait for tomorrow.
  `initializeCitationFacetIfUnderDailyCap` also carries an `AND leech_parked_at IS NULL` guard
  so a parked warm-up facet is never re-introduced as a flashcard.
- **Serve-only refresh.** `refreshWarmupSession` (session, both pools) re-serves with no
  parking/introductions — safe to poll while exercises generate. Resume-safe: serving covers
  every onboarding-parked term (already-parked + newly-parked), so a re-enter after
  `generating` placeholders never returns empty.

### Production→recognition bridge

Producing a word is strictly stronger evidence than recognizing it, so a term studied in
both pools never runs recognition onboarding on its own — without this, the recognition
facet would enter warm-up days after the production facet already graduated (the
production-first budget allocation), which reads as an already-learned word regressing to
warm-up.

- **Intro-side exclusion.** While a term's ENABLED production citation facet is **live**
  (`srs_state IS NOT NULL OR leech_parked_at IS NOT NULL` — scheduled or parked), its
  recognition citation facet is excluded from `listEligibleNewCitationFacets` (via the
  introduction order in `book-priority.ts`) and the due summary's `new_count`. Enforced at BOTH atomic write gates, not just queue
  selection: the warm-up park guard returns `not_eligible` and
  `initializeCitationFacetIfUnderDailyCap` refuses (reads as a cap refusal — the client
  drops the card), so a queue item or plan computed before production went live can't
  introduce. Demoting (disabling) the production facet lifts the exclusion. The vocab
  `up_next` stage deliberately keeps counting bridge-pending terms — the six-stage
  partition must cover every kept term; the bridge moves them to `review` at the next
  production credit.
- **Bridged credit** (`recognition-bridge.ts`, hooked after `applyTermRating`'s commit —
  covers every production rating surface). A
  citation-production `good`/`easy` credits the recognition sibling: a never-scheduled
  facet is seeded straight into review with the generous known-assert schedule
  (`seedKnownAssertFacet` — no `introduced_at`, so bridged introductions never consume
  the daily-new budget); an already-scheduled one gets an implicit FSRS `good`. Since
  recognition schedules at lower desired retention and every production review refreshes
  it, a bridged facet effectively never comes due on its own — until production evidence
  stops flowing (lapse, leech park, demotion), exactly when an independent recognition
  check regains value. Production `again`/`hard` propagate nothing (a production miss is
  not evidence the user can't recognize).
- **Silent direct write.** Like graduation (`unparkAndSoftReentryFacet`), bridge writes
  log NO `practice_rating_events` row: derived credit must not charge the review budget,
  count as practice activity, or enter the undo chain — undoing the production rating
  leaves bridged credit in place (the next production credit re-derives it). Seed-vs-refresh
  is chosen on the row-locked facet (the shared writer serialization point); parked and
  disabled recognition facets are never touched (a leech-parked recognition facet keeps
  its gates — direct recognition failure outweighs derived production evidence). The
  bridge is best-effort: it runs after the production rating committed, and a bridge
  failure is logged, never surfaced — failing the endpoint would invite a retry that
  double-applies the committed rating.
- **No backfill needed.** Terms already mid-recognition-warm-up finish their remaining
  gate days and graduate normally; already-scheduled recognition facets fade out as the
  bridge pushes their due dates past production's.

### Exercise bank + serve resilience

- **Exercise bank** (`exercise-bank.ts`, `practice_exercise` table): durable
  pre-generated exercises per `(user_lookup, pool, exercise_type)` — passive
  `mc_cloze, mc_comprehension, use_in_sentence`; active `mc_cloze, production_cloze,
  use_in_sentence`. `use_in_sentence` generates for both pools but is **ungated bonus
  only** (`gate_eligible = false`) — an LLM grading error must never block a graduation.
  Strengthen serves one gate exercise per parked term (oldest first) plus bonus exercises
  for this session's again/hard set.
- **Lifecycle + consume-on-answer.** Slots follow a fenced lifecycle:
  `pending → generating` (mints a `generation_token`) `→ ready → used | failed`; stale
  pending/generating slots (> 300s) are fenced off and replaced; an advisory lock per
  `(term, pool)` makes concurrent ensure calls race-safe. Serving is read-only
  (deterministic lowest-`created_at` ready row), so refresh/abandon before answering
  re-serves the same exercise — no bank drain, no in-progress state machine. Submitting an
  answer consumes the row (`used`), which doubles as the stale-answer fence; the next
  attempt always gets a fresh exercise (anti-gaming for gates). **Skipping consumes
  nothing.** Bank warm-up triggers, all fire-and-forget: an `again`/`hard` rating in
  either render mode (an optional hook on `applyTermRating`), parking itself (gates must
  exist before the user reaches Strengthen), each consumed slot (refill — narrowed to the
  consumed type for non-rehab consumes, full ladder for rehab gate answers, skipped on
  graduation), and the composed queue's hint pre-warm.
- **Accuracy-first generation** (cost explicitly not a constraint): Opus GENERATE →
  independent-context adversarial VERIFY (Opus by default; the `EXERCISE_VERIFY_MODEL`
  env var flips it for A/B trials — a Sonnet 5 stint tripled the terminal-failure rate),
  up to `MAX_GEN_ATTEMPTS = 3` full cycles before the slot fails. The verifier substitutes
  each distractor into the blank and fails the exercise if any substitution is
  grammatically valid AND semantically acceptable on a plain, natural reading (defenses
  needing irony, invented back-story, or unusual context don't count — an over-eager
  verifier terminally fails the whole term); distractors must match the answer's POS and
  inflection/agreement (so grammar alone can't eliminate them) while being semantically
  wrong in that sentence; production-cloze blanks must be inflection-unambiguous from the
  sentence's cues. Retries are informed, not
  blind: each cycle feeds the verifier's prior rejection reasons into the next generation
  prompt. Verifier verdicts are parsed leniently (a string `"true"` counts as pass) and a
  fail with zero reasons — a state the verify prompt forbids — is re-verified once before
  it counts, so a malformed tool call can't silently convert passes into rejections. Blank
  offsets are computed server-side by substring search over the emitted `surface_form`
  (never LLM char arithmetic); `mc_comprehension` requires a `surface_form` too and
  locates the term the same way, storing `termStart`/`termEnd` in the payload (served as
  optional fields — rows generated before the span existed serve without them, and the
  bank refreshes naturally since exercises are consume-on-answer). A deterministic guard
  rejects any sentence/`surface_form` containing underscores — the generator occasionally
  writes the sentence pre-blanked and echoes the blank back as the surface form, which
  would store the underscores as the answer — so the retry cycle regenerates instead
  (the cloze and comprehension prompts also forbid it explicitly); options are shuffled
  server-side. Generation prompts work from headword + sense (+ definition/translation
  when present) — no dependency on stored examples. `use_in_sentence` payloads are built
  deterministically (no LLM at generation time).
- **Grading is server-side only.** Served payloads are stripped of `answer` /
  `answerIndex` / `acceptedForms`; the truth (`correctIndex` / `correctAnswer`) is
  revealed only in the answer response, after the exercise is consumed. MC = index
  equality. Production cloze also accepts a `giveUp` response (and only production cloze:
  MC types can always guess, use-in-sentence has no canonical answer to reveal) — graded
  as a plain miss (same consume, no gate credit, same bank refill); only the client copy
  differs. Otherwise: NFD-normalize + strip diacritics + lowercase + trim, then
  exact match against accepted forms or Damerau-Levenshtein ≤
  `TYPED_ANSWER_MAX_EDIT_DISTANCE = 1` (shared dependency-free helpers in
  `@flicktionary/core/utils/typed-answer-grading`, so the client-graded session recap
  applies the exact same acceptance rules) — a missing accent plus one typo still passes.
  Use-in-sentence: Sonnet-graded; a correct sentence in **any legitimate sense** passes
  (real production is the point; it's bonus-only), but when the sense differs from the
  stored one the feedback must say so and give an example in the stored sense; grading
  failures degrade to attempt-only ("feedback unavailable"), never an error.
- **Failure-tolerant ladder.** The gate serve tries the tier's preferred type, then falls
  back to **any** ready gate-eligible exercise — a term whose required type can't be
  generated (the verifier keeps refusing a malformed headword) still progresses, since
  graduation is gated on distinct days, not a strict type sequence.
- **Pending vs terminal.** When nothing is ready, `countGateBankSlots` distinguishes
  still-cooking (`inflight > 0` → `generating` placeholder) from terminally exhausted (every
  gate-capable type failed → `failed` entry), and the serve stops re-reserving doomed
  slots. The exercise-session view polls the serve-only endpoint and swaps `generating`
  placeholders to `ready`/`failed` in place.
- **Terminal failure is a decision point, not a dead end.** The `failed` entry renders a
  decision card in both serving surfaces (composed queue + dedicated sessions): primary
  **Study as flashcard** calls `practice.studyParkedTermAsFlashcard`
  (`unparkTermToFlashcard` in `rehab.ts`) — the same soft-re-entry write as graduation
  except **due = now**, so the term is servable by the very next compose — with **Skip**
  as the secondary (Enter/Space = study, S/Esc = skip). Idempotent: an already-unparked
  facet returns `unparked=false`, never an error. Editing the term is the other exit:
  `chunks.updateContent` (when translation / definition / target example change) and
  `chunks.rename` delete the term's `failed` exercise slots (`deleteFailedForLookup`,
  both pools) — the old verdicts were about the old content — so the next serve reserves
  fresh slots and generation gets another chance.
- **Flashcard hints** reuse this bank. `practice.getHintExercise` (`getHintExercise` in
  `exercise-bank.ts`) serves ONE ready exercise of the pool's **hint type** —
  recognition → `mc_comprehension` (the card front already shows the headword, so
  `mc_cloze` would be trivially solvable), production → `mc_cloze` (the recall→recognition
  downgrade a hint should be; `mc_comprehension`'s sentence would leak the hidden
  headword). Hints exist only for **citation meaning facets** (the bank tests meaning and
  has no facet identity — same restriction as parking). Serving is bank-first and
  read-only: banked exercises from warm-up/rehab serve for free; a miss kicks a background
  top-up of just the hint type (skipped if that type failed terminally or is in flight).
  The initial compose request pre-warms gaps: `warmHintExerciseBanksForFlashcards` checks the
  served flashcards' hint slots in one query (`countSlotsByTermForType`; stale inflight
  counts as absent) and generates only for terms with **no hint-type slot at all**, capped
  at `MAX_HINT_WARMS_PER_COMPOSE` per compose — the serve-only refresh never warms.
  Answering goes through the normal `submitExerciseAnswer` (consume-on-answer; rehab
  no-ops since the term isn't parked); the refill after a **non-rehab** consume is
  narrowed to the consumed type, so a hint never fans out into whole-ladder LLM work
  (rehab gate answers keep the full-ladder refill — the tiers need every type banked).

### Dedicated exercise sessions (ExerciseSessionView)

Routes: `/practice/strengthen/$targetLanguage` (leeches + bonus; Zod search: `pool`,
optional `sessionHard` userLookupId array — carried in the URL so the list survives
refresh — and optional `mix`, the Daily Mix chain: when present, closing the session
continues the chain — next mix language, or the dashboard when this was the final
one — instead of the language landing) and
`/practice/warmup/$targetLanguage` (session-scoped warm-up; search
`studySessionId`) render the shared `ExerciseSessionView`, differing only in fetch source
and copy (`copyVariant: 'rehab' | 'warmup'`); day-to-day gate serving happens inside the
composed Practice queue itself. Strengthen's remaining entry point is the post-session CTA
(primary `Strengthen` button on the composed completion screen when the session produced
again/hard terms; the back button is the skip path — reading completion is unchanged
though its ratings still warm bonus banks); `startStrengthenSession` requests
`parkedOrigin: 'leech'` for its gate track. Warm-up has no dedicated UI entry point (§7
warm-up entry).

`startStrengthenSession` re-validates the client-supplied hard ids server-side (ownership,
language, `count > 0`, not deleted, an enabled `(meaning_production, '')` facet —
`disabled_at IS NULL`, enforced by the queue join — when `pool='active'`; silently drops
the rest) and returns one tier-typed gate exercise per parked term plus one bonus exercise
per validated hard term. A term with nothing ready gets a **`generating` placeholder**
(skippable) and a background bank top-up — the session never blocks on LLM work.

**Interrupted sessions resume** (`exercise-session-snapshot.ts`, the composed queue's
stash pattern): unmounting mid-session — the Edit-term focus-view detour, a back
gesture — saves the queue, position, correct tally, and the answered-but-not-advanced
outcome; the next mount of the same session scope (mode + language + `pool` + sorted
`sessionHard` + `mix` / `studySessionId`, same local calendar day, consumed on read)
seeds from the snapshot instead of re-running the start mutation — a restart would
recompose and re-serve every remaining gate. A resumed already-answered current
exercise renders as the read-only `AnsweredExercisePanel` (outcome + **Next**): the
server consumed it on answer, so remounting the live component would invite a
re-submit the server rejects. Deliberate exits (the X, completion/empty-state buttons)
never stash. The chunk soft-delete mutations splice a deleted term's not-yet-reached
entries out of the stash (`dropTermFromExerciseSession`); a correctly answered current
entry leaves the correct tally with it (its slot leaves the completion total). The
chunk edit mutations (content patch, rename), a chat turn whose tool patched the chunk
(`sendMessage.updatedChunk`), and full exploration rewrite the stashed entries' embedded
headword/meaning copies (`patchTermInExerciseSession`), so an Edit-term detour resumes
onto the updated content instead of the pre-edit snapshot. The
completion CTA names where close goes: `Back to ⟨language⟩` (plain session, to the
language landing), `Continue with ⟨next language⟩` (mid-mix), `Finish` (final mix
language, to the dashboard).

Exercise screens share an `ExerciseLayout`: scrollable content + a pinned bottom action
bar (the flashcard-view pattern), with an optional status-row slot above the actions
(filled by the composed queue's chevrons + chips row; empty in the dedicated sessions) and
a **post-answer feedback slot** pinned above the status row — verdict, expected answer,
meaning reminder, and rehab progress render there instead of in the scrollable body, where
they routinely landed below the fold on small screens. The bar is bottom-anchored, so the
feedback grows upward and the status row + actions never move; the slot is height-capped
with internal scroll so long LLM feedback (use-in-sentence) can't eat the viewport. The
header line is the shared `ExerciseHeader` — icon + uppercase track label (+ ` · headword`
when naming the term can't leak a cloze answer) + an optional right-aligned position
counter, which only the dedicated sessions pass (the composed queue's grows mid-session,
so `N / M` would read as broken there). Every unanswered exercise has a secondary **Skip**
(non-consuming — it re-serves next session, so "not now" doesn't burn the fresh exercise
or the day). Cloze exercises (`mc_cloze` + `production_cloze`) also offer an opt-in
**Hint** button beside Skip (same lightbulb treatment as the flashcard hint): pressing it
reveals the term's meaning under the sentence — the entry's `translation`/`definition`
resolved by the same rules as flashcard faces (definition-only when L1 = L2 or Show
translations is off; production cloze falls back to its generation-time `payload.hint`).
The hint is free — it never affects gate credit — and is never auto-expanded;
`mc_comprehension` gets no hint, since its options are meaning paraphrases. On production
cloze the hint slot escalates: once the hint is revealed (immediately, when no hint
exists) it becomes **Show answer** (eye icon) — a give-up that submits `{giveUp: true}`,
grades as a miss (consumes, no gate credit, fresh exercise next time), and renders a
neutral "The answer was: …" reveal instead of the red "Not quite. / Expected:" verdict.
Cloze blanks render as literal underscores. MC answers highlight the correct option from
the response's `correctIndex`; production cloze reveals `correctAnswer` on a miss;
use-in-sentence is labelled **Bonus**
and shows the LLM feedback. Every answered exercise appends a `Meaning: …` reminder line.
Gate answers render a "Day N of 3" rehab progress note from the response's
`rehabCorrectDays`, and `graduated: true` renders a graduation celebration ("back in your
practice rotation"); the dueSummary invalidation drops the parked counts.

## 8. Frontend session model (composed-practice-view.tsx)

The session's bookkeeping (queue, position, redrills, retries, re-rate, rating records,
hint/clue state, introduction claims, resume snapshot) is a pure reducer
(`composed-session-reducer.ts`); `useComposedSession` runs the side effects (compose,
ratings, undo, claims, placeholder poll, stash) and dispatches their outcomes; the view
renders.

- The queue is a **one-shot client-side slice of union items**
  (`{type:'flashcard'} | {type:'exercise'}`): seeded from the compose response (the
  route keys the view on the serialized filter). The read-only refresh
  poll (~4s while a `generating` exercise placeholder is at/ahead of the index) only
  upgrades placeholders in place (`mergeComposedPlaceholders`, keyed
  `(pool, userLookupId)`) — it never appends, so a term graduating mid-session becomes
  a flashcard on the NEXT session, not this one.
- **Interrupted sessions resume** (`composed-session-snapshot.ts`, a module-level
  stash): unmounting mid-session — the Edit-term
  focus-view detour, a back gesture — saves the full session (queue, position, rating
  records, exercise outcomes, claimed introductions, Strengthen set, cap flags), and the next mount of the
  composed route resumes it instead of re-composing, so a detour keeps the same planned
  batch instead of refilling an almost-finished session with new
  introductions. Resume requires the same language + filter and the same local calendar
  day (due-ness and daily budgets shift overnight); the snapshot is consumed on read.
  Resuming onto an already-answered exercise renders the read-only
  `AnsweredExercisePanel` (outcome + **Next**, the same panel the peek path uses)
  instead of remounting the live component — the server consumed the exercise on
  answer, and a re-submit would be rejected as no longer answerable.
  **Deliberate exits never resume**: the X/Back buttons and reaching the completion
  screen skip the save, so re-entering Practice from the language screen composes fresh.
  Unreached planned terms remain unintroduced. The chunk soft-delete mutations
  splice a deleted term's not-yet-reached items out of the stashed queue, so a "delete
  this card" detour resumes without it. Every chunk-content edit path — the edit
  mutations (content patch, rename), a chat turn whose tool patched the chunk
  (`sendMessage.updatedChunk`), and full exploration — rewrites the stashed copies of
  the edited term (`patchTermInComposedSession`: lemma-level card fields + the
  verified-IPA badge recomputed client-side, exercise headword/meaning lines), so an
  Edit-term detour resumes onto the updated card. Form cards refresh the same way: the
  facet-payload mutations (manual edit, generate-and-confirm) patch the matching form
  card's `facetPayload` from their refreshed study-targets response
  (`patchFacetInComposedSession`), and a hard facet delete splices the facet's
  not-yet-reached cards out (`dropFacetFromComposedSession`, same index rules as the
  term-level drop). A hard page reload still drops the session (the stash is in-memory
  only).
- **Exercise items** render through the shared exercise components
  (`McExercise` / `ProductionClozeExercise` / `UseInSentenceExercise`) with per-entry
  copy from `origin` (warm-up vs rehab); skips are non-consuming as in Strengthen.
  Each `StrengthenExerciseEntry` carries the term's `translation`/`definition`
  (straight off `user_lookups`), resolved client-side by `useTermMeaning` under the
  flashcard-face rules (definition-only when L1 = L2 or Show translations is off).
  That meaning powers an opt-in **Hint** button on the cloze types (`mc_cloze` +
  `production_cloze`; free — no effect on gate credit; `mc_comprehension` is excluded
  since its options ARE meaning paraphrases) and a post-answer `Meaning: …` reminder
  on every type; on production cloze the hint slot escalates to the **Show answer**
  give-up described in §7. Post-answer feedback (verdict / expected answer / meaning / rehab
  progress) renders in `ExerciseLayout`'s pinned feedback slot above the status row —
  always visible, height-capped — instead of the scrollable body.
  Flashcard items render `FlashcardFace` (the extracted presentational card body) +
  `RateButtons`.
- **Select-to-gloss on exercise sentences.** Exercise stems render through
  `SelectableSentence` (word pieces per the `use-word-selection` span contract) inside a
  per-exercise `GlossableArea`, which owns the gesture and mounts the same fire-and-forget
  `LookupSheet` (stateless `glosses.fastGloss`, `cards.createAdhoc` save;
  the stem sentence is the context). Gating, enforced by a pure resolver
  (`resolveGlossSelection`) that rejects any selection overlapping a rejected range:
  - The **cloze blank** (`mc_cloze` / `production_cloze`) renders as the `______` gap and
    its span is **always** rejected — the served sentence physically contains the hidden
    answer there, so a drag sweeping across it must never reach the sheet.
  - The **comprehension term** (`mc_comprehension`) is underlined via the served
    `termStart`/`termEnd` (same style as the recap quiz) and its span is rejected until
    the answer lands, then unlocks. Pre-span rows (no offsets in the payload) can't be
    gated word-by-word, so their whole sentence stays unselectable pre-answer.
  - **Options**: only `mc_cloze` options become glossable, post-answer (they're
    target-language words; the stem is their gloss context). `mc_comprehension` options
    are native-language paraphrases and stay plain.
  Exercise hotkeys (numbers, Skip, Enter/Space, production's Escape) are inert while a
  gloss sheet is open; closing the sheet clears the selection paint. Saved terms land
  Unseen — no effect on the running session or budgets.
  Applies to every exercise host: warm-up/strengthen sessions, the composed queue, and
  flashcard-hint mode (the session-recap quiz mirrors this — see REVIEW-SPEC).
- **Flashcard hint**: on the un-flipped front of a live citation-meaning flashcard, a
  `Hint` button appears beside `Show answer` when `practice.getHintExercise` has a ready
  exercise (availability is best-effort — null or a failed check just hides the button;
  `useSubmitExerciseAnswer` invalidates the hint query so a consumed exercise is never
  re-served from cache). The client prefetches the upcoming queue item's hint availability
  while the current one is displayed — the availability query is cached per
  `(userLookupId, pool)`, and redrill copies share the original card's cache key — so the
  footer renders Hint + Show answer from the card's first frame instead of splitting a
  beat after it appears. Pressing it swaps the card for the MC exercise (`McExercise`
  with relabeled actions: `Back to card` backs out non-consuming, `Show answer` after
  answering). Answering **locks the rating** — correct → `hard`, wrong → `again` — and
  reveals the card back with a single `Continue` that applies it through the normal
  `handleRate` machinery (redrill, rating records, leech toast), so re-rate/undo work
  unchanged. The kebab withhold extends to an unanswered hint `mc_cloze` (a production
  card hides its headword, which IS the cloze answer). Abandoning between answer and
  Continue loses only the rating (the exercise is already consumed) — same
  dropped-session semantics as the rest of the queue.
- **Word-family clue**: on the un-flipped front of a live
  `meaning_recognition` flashcard (citation or form facet) in a word-family language, a
  `Clue` button appears before Hint / Show answer when the card's word-family line
  (`glosses.wordFamily`, the same cached query as the back's slot; the upcoming card's is
  prefetched so the button is there from the first frame) has a known/saved relative, a
  form-of note, or an explained part (`frontClueFor`; bare unexplained parts mostly restate
  the headword). Pressing it shows the line under the front **without cognates** ("Looks
  like: dozen" is near the answer) and leaves the button in place, disabled as `Clue shown`,
  so the footer doesn't shift and a double tap can't land on Hint (which would consume the
  hint exercise and lock the rating); the revealed back's `wordFamily` slot then carries the
  full line, so the front copy hides. Using it **caps the rating at Good**: Easy is disabled
  (with a muted note) and `4` is inert — on the live back and on a peek re-rate of that
  item. Clue use is tracked per queue item (`clueUsed`; an Again redrill is a fresh attempt, but a
  failed rating's retry copy and a failed re-rate's requeue inherit the cap)
  and rides the resume snapshot, so the Edit-term detour can't hand Easy back. Client-side
  only, like the hint lock. The MC Hint stays available after a clue; its hard/again lock
  wins. The word-family hints pref off means no line and so no Clue.
  **Production variant**: a live `meaning_production` front (citation or form facet) gets the
  same button, footer, `C` key and Good cap, but never the line itself: parts, anchors and the
  form-of lemma would spell the answer. `productionClueFor`
  (`apps/web/src/features/practice/utils/card-word-family.ts`) derives a meaning-only clue
  from the same cached line (`ProductionClueLine`): role-labelled part meanings
  (`prefix *into a state* + root *to freeze*`; a linking vowel is dropped, and an affix-only
  breakdown like по- + -нимать promotes its stem to root), the form-of kind without its lemma
  (`participle · …`), and `(a word you know)` / `(a word you saved)` on a root that is one of
  the learner's anchors (other anchors are not mentioned). No clue when the line has
  cognates (a loanword: its sound is the answer), no part has a meaning (insight not cached
  yet, or opaque), a meaning contains Cyrillic, or a meaning is an en etymology note
  (`from french …`). Hidden when translations are off for the language or no native language
  is set: explanations are then in the target language and can share the answer's root.
- **Again-redrill**: rating `again` optimistically appends a copy of the card to the local
  queue in the same render as the index advance (so the Learning pill never dips); the copy
  is rolled back by object identity if the server says cap-rejected / parked / error — unless
  the session already walked past it (the reducer checks the live index), so a consumed
  copy is never removed.
- `sessionHard` collects this session's again/hard terms → offered to Strengthen
  afterwards.
- **Completion settling barrier**: `handleRate` advances optimistically and records the
  rating only when its response lands (a failed mutation re-appends the card), so the
  completion screen can render while the last rating is still in flight. Each rating (and
  each half of a re-rate) settles on its own request promise — a rating sent before the
  previous one returned keeps both outcomes. Responses landing after the view unmounted
  (an Edit-term detour) are ignored: the saved snapshot is the session, and an interrupted
  re-rate starts no follow-up rating. A reactive pending counter
  (incremented per `rateTerm`, decremented when it settles; an in-flight re-rate counts too) gates every
  completion-screen exit while anything settles: a "Saving your ratings…" line replaces
  the recap/actions state, Strengthen / Back / Learn-extra (and the mix interstitial's
  Continue / Strengthen-first / Done-for-now) are disabled, the completion `Enter`
  hotkey is inert, and the header X is a no-op on the completion screen (mid-session it
  stays a live deliberate quit). Leaving early would clear the exhausted snapshot, lose
  a failed rating's requeue, and undercount the mix recap.
- **Peek + re-rate**: the back-chevron (`peekBack`) shows previous items. A peeked
  **flashcard** whose rating durably applied (rating record keyed by queue-item identity,
  holding the response's `eventId` + its redrill copy) re-shows the rating buttons with the
  previous rating highlighted — unless its redrill copy was itself already rated (the
  original's event is no longer latest; the server would refuse, so no dead buttons).
  Re-rate runs undo → fresh rate (§5), then reconciles: old `again` → new `good`+ removes
  the unconsumed redrill copy; old `good`+ → new `again` appends one; `sessionHard`
  updates by lookupId. Any outcome that leaves the card unrated server-side (stale undo,
  cap refusal on the fresh rate, error after a committed undo) drops the record and
  re-appends a fresh queue item so the card resurfaces rateable. A peeked **exercise**
  is read-only (its answered/skipped outcome) — a consumed exercise can't be
  un-answered.
- **Edit during practice**: a header kebab opens an actions menu (`TermActionsOverlay`) for
  the term behind the displayed item — flashcard or exercise alike (an exercise entry
  carries its own `userLookupId`); `Edit term` deep-links to the focus view via
  `chunks.get`'s representative-card pointer (`firstCardId`/`firstCardSessionId`, fetched
  lazily on menu open) with `?scope=language` — no origin params. The focus view's close
  pops history back to the serving route's identical route+search entry — composed queue,
  Strengthen, and Warm-up alike — where the stashed session snapshot resumes where it
  stood (`composed-session-snapshot.ts` / `exercise-session-snapshot.ts`).
  The kebab is **withheld while it could spoil an answer**: an unanswered cloze exercise
  (the headword IS the cloze answer) or a live `generating` placeholder, which can swap in
  place to a cloze on the next poll — the generating placeholder's body copy and exercise
  header are headword-less for the same reason (terminally `failed` placeholders and peeked
  never-swapped items still name the term).
- **Status row**: the sticky bottom control area is ONE row shared by every item type —
  flashcards, exercises, hint mode, and peeked items alike: peek chevrons framing colored
  remaining-count chips (derived from the remaining local queue, `getRemainingCounts` in
  `review-counts.ts`). Chips bucket by **learning stage, not render type**, four buckets:
  `new` (planned onboarding gates — `isNewIntroduction` — plus
  never-reviewed opt-in flashcards), `warmup` (returning backlog gates from earlier
  composes; the pill hides at 0 — gate-free sessions never have any),
  `learning` (learning/relearning flashcards + `Again`-redrills + rehab gates), `review`.
  The split makes introductions visible in-session and matches the landing's vocabulary:
  the session-plan card shows the same four numbers before the user presses Practice.
  Each chip is a press target opening a short explanation popover (click/tap only, never
  hover — the chips sit next to the answer buttons, where hover-open would misfire
  constantly); below the `sm` breakpoint the chip labels collapse to screen-reader-only
  (dot + count) so the row fits phone widths. The back chevron is withheld while a live
  exercise or hint is displayed (peeking away would unmount it, and an already-consumed
  exercise can't be re-answered on remount).
- The per-language landing derives servable work from the `previewPracticeQueue` response
  (§4b) — no client-side budget math; the `/practice` selector rows still compute their
  one-line summaries client-side from the due summary + `getPracticeLimitsForLanguage`.

### Daily Mix (the dashboard's cross-language chain)

One dashboard CTA that clears every language's practice queue in sequence.

- **Banner** (`daily-mix-banner.tsx` on `/dashboard`): languages ordered
  most-recently-practiced first (`dueSummary.lastPracticedAt` desc, never-practiced
  last, ties alphabetical — `orderMixLanguages`). Per-language numbers are the SAME
  session-plan previews the practice landing shows: `usePreviewPracticeQueues` is a
  `useQueries` batch over the single-language `previewPracticeQueue` query options
  (shared cache keys → parity by construction), each chip summing
  `new + warmup + learning + review`. Zero-planned languages are skipped; past ~6
  chips the row folds into `+N more`; exactly one qualifying language degrades to a
  plain default session (no `mix` param, no interstitials); a zero planned total keeps
  the slot as a quiet "All caught up for today" card (location learnable, no layout
  jump). A failed preview never renders as zero — the banner swaps to a retry state
  that refetches the failed queries.
- **The chain is the URL**: Start opens `/practice/composed/$first?mix=<chain>` with
  the default filter. `mix` carries the FULL ordered chain (done + current + upcoming);
  position derives from the route's language param (`splitMixChain`), so the value is
  stable across the run and a refresh keeps the chain (the current language recomposes
  fresh, the rest survive). `mix` is stripped from the compose filter and excluded from
  the remount key — which is `` `${targetLanguage}:${JSON.stringify(filter)}` ``, the
  language part being what makes a mix hop remount a fresh one-shot session. A
  hand-edited `mix` that omits the current language degrades to a plain session.
- **Interstitial** (`mix-interstitial.tsx`, replacing the completion screen mid-chain):
  recap of the finished language (`computeMixRecap`, unit-tested — cards done = rated
  cards excluding `again`-redrill copies + answered exercises; **new introduced counts
  CLAIMED introductions**, since the daily slot is spent the moment the gate is
  reached, so a claimed-then-skipped generating/failed exercise still counts; warmed
  up = answered non-introduction onboarding gates), chain progress chips
  (done ✓ / next highlighted / upcoming), an "Up next" block in the sticky footer
  (above the buttons, under the border) naming the next language plus its planned
  total from `previewPracticeQueue` — the same query (and cache entry) the Daily Mix
  banner and language landing use, so the promise matches what the next compose
  serves; raw due-summary counts would overpromise (warm-up backlog ≠ gates served) —
  primary **Continue** (`Enter`), a secondary **Strengthen first**
  when the session produced again/hard terms, and a ghost **Done for now** → the
  dashboard (progress keeps — ratings are per-card; the banner re-derives the
  remaining chain next time). The final mix language falls through to the normal
  completion screen plus a "Mix complete" line — Strengthen offer intact, while
  **Learn extra is suppressed mid-mix** so the chain's pacing isn't derailed; its
  close CTA reads **Finish**. Every mix exit — Finish, Done for now, the header X —
  returns to the dashboard (the mix is dashboard-owned: its banner is the entry
  point, and the dashboard shows the progress the run just moved); plain
  single-language sessions keep `Back to ⟨language⟩` → the language landing.
- **Detours carry the chain**: an Edit-term detour pops history back to the serving
  route — the composed queue or a mix-launched Strengthen session — whose own search
  carries `mix`, so the chain survives without any focus-view threading; Strengthen's
  close continues to the next mix language (or the dashboard from the final one)
  instead of the language landing, and its completion CTA names the destination
  (`Continue with ⟨next language⟩` / `Finish`).

### Landing + language action screen

`/practice` is a per-language selector. Each row shows the full language name plus a
status line and opens `/practice/language/$targetLanguage`. The line leads with the
session-plan preview's planned total (`N cards ready`, via `previewPracticeQueues` —
the same per-language cache entries as the Daily Mix banner and the language landing's
plan card, so no surface promises cards the compose won't serve); at zero it reads
"All caught up", or "Daily new limit reached" when the spent introduction budget is
what zeroes it. Deck descriptors follow: `· N in production` (production study
enabled) and `· N parked` (both pools' leeches). The skeleton waits for the previews
too, and a failed preview renders "Couldn't load your session preview" rather than
reading as caught up — the language landing behind the row owns retry.

Above the language list, first-time users see a one-time **"How practice works"
explainer card** (spaced repetition, session composition + daily limits, warm-up —
three short points, plus a deep link to `/user-guide#practice`). "Got it"
or the X records the `practice_explainer_dismissed` account flag
(`users.account_flags`, synced across devices), after which the card never returns and
the static one-line intro paragraph takes its place; neither renders until prefs have
resolved, so returning users see no flash. The zero-vocabulary **empty state**
describes the real pipeline — save a term in a session → background enrichment →
auto-kept into Vocabulary/Practice — and links back to `/sessions`.

`/practice/language/$targetLanguage` is the per-language landing — the system makes the
strategic decision, not the user. Two truth-telling surfaces replaced the old one-line
status summary and stat cards (Follow-ups / New today / Unseen / Total):

- **The session-plan card** (`session-plan-card.tsx`, inside the "Your next session"
  section next to the primary **Practice** button): what pressing Practice will actually
  serve, rendered with the SAME four-pill component as the in-session chips
  (New = introductions this compose plans / Warm-up = backlog gates / Learning /
  Review) and fed by `previewPracticeQueue` (§4b) — server-computed from the plan the
  composition materializes, so the card and the session open with identical numbers.
  Below the pills, a budget line shows introductions already consumed today; the forward-looking
  `dailyLimitReached` flag is not presented as already spent. A zero remaining budget with
  candidates gets a limit heading instead of "All caught up." Preview failures render an
  explicit retry state rather than an empty/skeleton state.
- **The funnel** (`practice-funnel.tsx`): the deck's stage pipeline — a slim proportion
  bar over the five ACTIVE stages (Up next / Warming up / Learning / Review /
  Strengthen; Unseen is a row but never a bar segment — it usually dwarfs the rest and
  would crush the bar) plus tappable rows (≥52px, dot + label + count + chevron) that
  deep-link to `/vocabulary?lang=<lang>&status=<stage>`. Counts come from the due
  summary's stage populations (below), which share `vocabStageClauseSql` with the
  Vocabulary filters — the row count and the filtered list agree by construction. The
  Up next row's second line shows the preview's `plannedIntroductions.recognition`
  ("N enter your next session") so the waiting total can't read as a session promise.
  Recognition lifecycle only; production work shows in the plan card. Strengthen hides
  at 0; stage colors rhyme with the chips (blue/amber/rose/emerald + violet).

A secondary **Custom practice** button opens an
overlay with the focused presets (`Review (due, no new)`, `Flashcards only`, `Learn new`,
`Exercises only`, `Production focus` — each just a composed-queue filter spec) and a
build-your-own filter panel (pools / scope /
item types / opt-in-new toggle, with inline reasons on contradictory combos — e.g.
new-only + flashcards-only without opt-in cards is empty by construction).

The **due summary** endpoint returns per language: `newCount` (unseen), `reviewDueCount`,
`learningDueCount`, `nextLearningDueAt`, `newIntroducedTodayCount`, `reviewedTodayCount`
(off the event log), `lastPracticedAt` (the later of the last live — non-reverted,
non-imported — rating and the last answered exercise's `used_at`, so exercise-only
warm-up activity counts; null = never practiced; two grouped repo reads merged in the
handler, ordering the Daily Mix), `parkedCount`, `warmupCount`, the `production*` mirrors
(`productionParkedCount`, `productionWarmupCount`, …), and the recognition **stage
populations** `upNextCount` / `learningCount` / `reviewCount` / `unseenCount`
(`vocabStageClauseSql` — see SPEC.md's Vocabulary section for the partition semantics).
The parked population is split by
origin **on both pools**: `parkedCount` / `productionParkedCount` are leech-only (parked +
`srs_state IS NOT NULL`), `warmupCount` / `productionWarmupCount` are onboarding (parked +
`srs_state IS NULL`); the composed queue serves both origins' gates in one session.
`newCount` / `productionNewCount` exclude parked rows so a warm-up term is never advertised
as servable-new; `newCount` also excludes terms whose production citation facet is live
(the bridge covers them — §7), keeping the same no-overpromise invariant. On the client, `dueSummary` and `previewPracticeQueue` are ONE
invalidation unit (`practiceSummaryKeys()` in `practice-hooks.ts`, spread by every
mutation that can move practice state — including the vocabulary / review /
lesson-import / prefs hooks); a mutation that refreshed one but not the other would leave
the plan card promising a session the compose no longer produces.

### Flashcard faces

Card face composition is declarative in
`packages/core/src/constants/card-face-config.ts`. `DEFAULT_CARD_FACE_CONFIG` shows
`headword` + `targetExample` on the front and `translation` / `definition` /
`nativeExample` / `grammar` / `wordFamily` on the back; `ru` and `en` (the Kaikki-grounded languages with
Wiktionary IPA today) defer `ipa` to the back on recognition cards, since pronunciation is
part of the answer. The resolver filters abstract slots by runtime conditions:
translations/native examples hide when L1 = L2 or Show translations is off, definition
shows in that hidden-translation mode and also falls back when translations are enabled
but no translation exists, IPA shows only when `pickIpa` returns a displayable bucket, and
grammar shows only when chips can render. Headwords use `grammar.display_form || headword`
so Russian stress-marked forms carry through.

Production cards flip the direction (`PRODUCTION_CARD_FACE_CONFIG`, language-independent):
the front prompts with the gloss (translation, or definition per the same resolver rules) +
the example translation; the back reveals `headword` / `ipa` / `targetExample` / `grammar` /
`wordFamily`.
A card with no gloss data at all would resolve an empty front, so it falls back to the
recognition layout. For languages whose grammar config lists `aspect` (Russian today), the
front's gloss line carries a muted dictionary-style aspect tag — "to see *(impf.)*" — so
the prompt disambiguates aspect twins (ви́деть vs уви́деть). The tag is `getAspectTag`
(`packages/core/utils/verbal-aspect.ts`), gated by language + POS exactly like the grammar
chips (a stray aspect value on a non-verb never surfaces); form cards inherit the lemma's
aspect through the `resolveCardContent` grammar fallback. Front only — the back's grammar
chips already show aspect, and a recognition front shows the headword itself.

Both pools' backs end with a `wordFamily` slot: the reader's word-family line
(`packages/ui/src/components/word-family-line.tsx`, `docs/READER-SPEC.md`) for the card's
lemma — structure (`за- + брать`) and up to 3 relatives the user knows or has saved. Meaning
cards in word-family languages (`ru`) fetch it through `glosses.wordFamily` (headword +
`grammar.pos`; `useCardWordFamily`) while the front shows, so it is ready on reveal; the
`word_family_hints_enabled` pref is enforced server-side. The endpoint never generates the
LLM insight — part meanings and cognates appear only once it is cached for that lemma. The
initial compose request warms missing ones in the background (`warmWordFamilyInsights`,
next to the hint-bank warmer, same `warmFlashcardCaches` flag — the serve-only refresh never
warms): for the served non-pronunciation flashcards, when the hints pref is on, it resolves
each headword + `grammar.pos` exactly as `glosses.wordFamily` will, skips cached insights,
non-content POS, multi-word headwords and requests already in flight, and starts at most
`MAX_INSIGHT_WARMS_PER_COMPOSE` (10) generations per compose. A warmed insight shows from a
later review of the card (the current one already fetched its line). On a production front
the breakdown and parents would spell the answer, so production shows the line on the back
only. On request, a recognition front shows it as a clue and a production front shows a
meaning-only clue; both cap the rating at Good (see "Word-family clue" above).
Pronunciation cards don't show it.

### Keyboard shortcuts (desktop)

Every practice surface — the composed queue, the dedicated Strengthen/Warm-up sessions,
and the session recap — is fully keyboard-drivable through one shared data-driven hook
(`apps/web/src/hooks/use-hotkeys.ts`: a global keydown listener per view with per-binding
enabled gates; a matched key always `preventDefault`s, which both stops Space-scroll and
suppresses native re-activation of a still-focused button). Bindings: flashcard front
`Space`/`Enter` = Show answer, `H` = Hint (when banked), `C` = word-family Clue (when offered); flashcard back `1`–`4` =
Again/Hard/Good/Easy with `Space`/`Enter` = Good (Anki muscle memory; digits match by
**physical key position** — `event.code Digit/Numpad` — so bare top-row presses work on
AZERTY); hint outcome `Enter`/`Space` = Continue; MC exercises `1`–`4` pick an option, `H`
reveals the meaning hint, `S`/`Esc` skip; typed exercises autofocus their input on
desktop, whose own `Enter` submits (use-in-sentence is chat-style: `Enter` submits,
`Shift+Enter` newline) — the only globals that fire while typing are `Esc` = skip and the
post-answer `Enter`/`Space` = Next; still-generating placeholders `S`/`Esc`/`Enter`/
`Space` = skip; failed decision cards `Enter`/`Space` = Study as flashcard, `S`/`Esc` =
skip; peek mode `←`/`→` drive the chevrons (same withhold rules), `1`–`4` re-rate when
offered (`4` inert on a clue-capped card), `Enter` returns to the current card; completion screens `Enter` = the primary
action (Strengthen when offered, else close — `Space` is deliberately unbound there so
Anki-style space-hammering through the last cards can't launch Strengthen). Single letters
and digits never fire while an editable element has focus, browser/OS chords
(`meta`/`ctrl`/`alt`) are never hijacked, key-repeat only re-fires for bindings that opt
in (focus-view nav), and all bindings suspend while the term-actions kebab overlay is
open. The UI teaches the keys with small `<Kbd>` badges (shared `packages/ui` component)
rendered inside the buttons/MC options they trigger — desktop-only (`useIsMobile`), and
sourced from the same binding data so badge and behavior can't drift.

## 9. FAQ / gotchas

- **"I set the review limit to 0 but still get cards."** Learning/relearning-state cards are
  budget-exempt by design (§3). The limit only gates review-state cards.
- **"I set both limits to 0 and it didn't stick."** Both-zero is rejected (sum>0 contract
  refine) and the clamp treats 0/0 as defaults; the settings inputs snap back on blur.
  Pausing a language is currently not a feature.
- **"A card I answered correctly came back the same day."** Only possible via `again`
  (no 24h floor) or in the active pool (never floored).
- **"Why did my failed card disappear from rotation?"** Probably parked as a leech (4th
  lapse). It now shows up as a rehab gate exercise inside the daily Practice queue — it
  graduates back to flashcards after 3 rehab days.
- **"I mis-tapped a rating."** Peek back with the chevron and re-rate — the undo refunds
  the budget slot and the fresh rating recomputes FSRS from the restored snapshot. Not
  offered when the card's `again`-redrill copy was already rated (the original event is no
  longer the latest), or after leaving the view (rating records are in-session state).
- **Daily windows roll over at UTC midnight** (server `CURRENT_DATE`), not local midnight.
- **Refreshing mid-session** refetches a fresh queue but cannot refill spent budgets — the
  review budget is counted off the append-only event log. Undone ratings DO refund their
  slot (the budget queries filter `reverted_at IS NULL`).
