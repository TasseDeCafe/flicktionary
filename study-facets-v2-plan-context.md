# Study facets v2: a two-axis (target × skill) note/cards model for the SRS

> **STATUS (2026-06-09): Phases 1–4 are MERGED** (PRs #116–#122, including the 4b follow-up PRs
> #121/#122 which added the per-form card editor and made recognition deselectable). Only the
> **Roadmap** section remains future work. Post-merge fixes landed 2026-06-09:
> - `listDueSummary` recognition counts now require an ENABLED facet (`disabled_at IS NULL`, plus
>   `rf.id IS NOT NULL` for `new_count` since `srs_state IS NULL` is also true on a join miss).
>   Phase 3+ made recognition disableable but the landing still counted disabled facets as "new
>   available" while the queue refused to serve them ("No new terms to learn" with "2 available").
>   `newIntroducedTodayCount` deliberately stays unfiltered (an introduction consumed today's
>   budget even if disabled later).
> - Opt-in new intake generalized to the ACTIVE pool: `resolveReviewCaps` opens the opt-in bucket
>   (`maxOptInNewTerms`) for `learn_new` in BOTH pools — production FORM facets are opt-in too
>   (the "active pool has no opt-in facets" assumption went stale with the per-form editor).
>   `listDueSummary` gained `optInNewCount`/`activeOptInNewCount` (mirroring the queue's opt-in
>   bucket predicate) so the landing's Learn-new button gating and batch sheet can see opt-in
>   work; an extras-only session enters learn_new without a `count`.
> - Triage Keep no longer clobbers a pre-keep study-target configuration: `applyKeepTransition`
>   now calls `ensureDefaultCitationFacetIfUnconfigured` — the citation recognition facet is a
>   keep-time DEFAULT created only when the term has NO `study_facets` rows. Touching the
>   selector pre-keep (e.g. pronunciation-only) means "this is the full set"; recognition must
>   then be checked explicitly. Row-existence (not "no enabled facet") so dormant terms aren't
>   resurrected by a re-keep. The repair paths (`rate-term.ts`, `advance-reading-text.ts`) keep
>   the unconditional `ensureCitationFacet`.

> **Reading order for the implementing thread:** read **The model** and **Worked examples**
> first — they encode decisions reached in a long design discussion and the terminology is
> deliberately *not* Anki's. Then the schema, then phases. The **Traps** section at the bottom is
> where the expensive mistakes live; skim it before writing any migration or query.

## Context

The app's study model is vocabulary-centric: one `user_lookups` row ("the word") holds both the
content (headword/sense/translation/grammar) and **two** hand-rolled SRS column families —
`srs_*` (passive/recognition) and `active_srs_*` (production) — plus per-pool leech columns. A
third ad-hoc study target hides in `grammar.study_form_enabled` (the "Study this exact form"
toggle), which mutates the passive card's *front* instead of being its own card with its own
schedule.

We want to study **multiple independent targets per word**, each with its own schedule and data:
- meaning **and** pronunciation of "caveat" (English),
- a verb's lemma **and** several specific inflected forms ("suis", "sommes", "êtes" for *être*),
- in inflected languages, **recognition and production** of each form, and eventually the
  **stress/pronunciation of a specific form** (Russian noun-stress shifts across cases).

That is Anki's note→cards split — but Anki's "note"/"card" vocabulary is generic and confusing,
and a flat list of card types can't express "the pronunciation *of a specific form*" without
combinatorial enum explosion. So this plan adopts a **two-axis** model and a clearer vocabulary,
migrates the two existing pools into it behavior-preservingly, then ships the new targets
incrementally.

**This supersedes the earlier single-axis `facet` plan** (`yeah-that-document-is-radiant-fog.md`).
The key change from that draft: a "facet" is no longer a flat enum value
(`passive|active|pronunciation|form`) — it decomposes into **`skill` × `target_form`**, and the
"Active vocabulary" concept dissolves into a skill toggle. Everything else (clean cutover, no
silent history loss, append-only migrations) carries over.

---

## The model (read this carefully — terminology is intentional)

### Vocabulary (ours, vs Anki's)

| Concept | Anki's word | **Our word** | Where it lives |
|---|---|---|---|
| The word being studied (one headword+sense) | note | **term** | `user_lookups` row. Code already says `term` (`rateTerm`, `listReviewTerms`). |
| One independently-scheduled card on a term | card | **facet** | one `study_facets` row — own SRS + leech state + payload. |
| *What surface of the word* a facet drills | (n/a) | **target** (`target_form`) | `''` = the citation form (lemma); else a specific inflected form string. |
| *What you practise* on that target | card template | **skill** | `meaning_recognition` \| `meaning_production` \| `pronunciation`. |
| Which session queue a card is reviewed in | (deck-ish) | **pool** | `pool` on the wire/route params: `passive` / `active`. **Derived** from skill's review mode; stays on the wire to avoid churn. |
| The genuine "deck" (daily limits live here) | deck | **target language** | per-language caps. Pool was never the deck — language is. |

**A facet is a `(skill, target_form)` pair on a term.** Its identity — what undo restores and what
the budget counts — is `(user_lookup_id, skill, target_form)`.

### The two axes

```text
                 ┌─ meaning_recognition  (see surface → recall meaning)
   skill  ───────┼─ meaning_production   (see meaning  → produce surface)
                 └─ pronunciation        (see surface → recall its sound/stress)

   target_form ──┬─ ''            (citation / lemma — render from headword+grammar)
                 └─ "<form>"      (a specific inflected form — payload {form, translation})
```

Every `(skill, target_form)` cell is a legal, independently-schedulable facet. For *être*:

| target_form | meaning_recognition | meaning_production | pronunciation |
|---|---|---|---|
| `''` (être) | see être→meaning | see "to be"→être | see être→IPA |
| `êtes` | see êtes→meaning | see "be, 2pl"→êtes | see êtes→stress *(roadmap)* |

### `pool` is **derived**, not a third axis

`pool` (the session queue) = the **review mode** of a skill, and review mode is a static property
of skill:

- `meaning_recognition` → recognition → **pool `passive`**
- `pronunciation`       → recognition → **pool `passive`**
- `meaning_production`  → production  → **pool `active`**

So the **`pool` wire field and `?pool=` route param stay exactly as today** (`passive`/`active`) —
they name *which session queue you entered*, not card identity. There is no migration of route
params or the ~6 contract endpoints that carry `pool`. Internally, the passive queue serves skills
`{meaning_recognition, pronunciation}`; the active queue serves `{meaning_production}`.

**Legal `(pool, skill)` pairs — validate server-side in `rateTerm`/`undoRating`:**
- `pool='passive'` → `skill ∈ {meaning_recognition, pronunciation}` (any `target_form`)
- `pool='active'`  → `skill = meaning_production` (any `target_form`)
- Reject anything else (a crafted `pool='active', skill='pronunciation'` must 400).

### "Active vocabulary" dissolves

There is no longer a term-level "active" flag the user thinks in. `learning_mode='active'` on
`user_lookups` is **dropped** as a user concept; "is this word in production study?" becomes "does
it have an **enabled** (`disabled_at IS NULL`) `meaning_production` facet?". The "Switch to active
vocabulary" button and the triage passive/active fork go away (see Phase 3). The session selector is
still recognition-vs-production (wire `pool`), because they're genuinely different interactions.

**Critical: facet *existence* ≠ *enabled*** (Trap 15). Demoting active→passive today **preserves**
`active_srs_*` so a re-promote resumes the schedule (verified comment at
`user-lookups-repository.ts:814-816`). So a *demoted* term has `learning_mode='passive'` but live
production history. If Phase 1 backfills a production facet from that history and Phase 3 treats
"facet exists" as "in production study", every demoted term silently re-enters production. Therefore
**`disabled_at` carries the membership bit, not row existence**: a production facet backfilled from a
demoted term is created **disabled** (`disabled_at` set), history intact, not queued; promote clears
`disabled_at`, demote sets it. Same for any future opt-in facet — disable ≠ delete, and the queue
filters `disabled_at IS NULL`.

### Facet readiness: `pending_data`

Saving a **term** and enabling a **facet** are separate acts. A facet whose render data exists
(citation meaning; citation pronunciation when Wiktionary has IPA) is **ready** and schedules. A
facet whose data is missing (a form's translation/pronunciation we haven't generated) is
**`pending_data`** — enabled but NOT in any queue — and shows a "generate / enter manually"
affordance inline. This decouples "save the word" from "this card is drillable", and is how the
generate-and-confirm pipeline (Phase 4) hangs off the model without blocking saves.

### Sibling **spacing**, not Anki "burying"

Siblings = facets of the same term. We do **not** drop siblings from the session (Anki buries them
to tomorrow). We keep them all but **space them apart** so no two siblings are adjacent — there
must be other cards between "mange" and "manges". Mechanism: rank each due facet within its term
(`ROW_NUMBER() OVER (PARTITION BY user_lookup_id ORDER BY <priority>)`), then order the queue so
all rank-1 facets precede all rank-2, etc. A term's 2nd card lands after every other term's 1st
card. This matters even for productive form-siblings: seeing "vas" hands you "allons" for free
(shared root), so they must never be back-to-back.

**This is best-effort, NOT a guarantee** (Trap 16): if one term dominates the due set (5 due
facets, only 2 other terms), its rank-4/rank-5 siblings have no separator left and **will** be
adjacent at the tail. We accept tail-adjacency for these phases — no deferral/burying fallback.
Tests must cover "one term, two facets" and uneven sibling counts so the ordering degrades
gracefully rather than crashing or looping.

### Budgets

- **Review load** (the "X due / X done" number and the daily review cap): one slot per **facet** =
  `COUNT(DISTINCT (user_lookup_id, skill, target_form))`. caveat-meaning + caveat-pronunciation =
  2 slots; redrilling one facet in-session = 1. UI label becomes **"reviews"** (not "cards" —
  Anki jargon — and not "words/terms" — now ambiguous).
- **Daily-new pacing**: consumed **only** by the first citation `meaning_recognition` facet of a
  term (= "I'm starting to learn this word"). Pronunciation, production, and every form/skill you
  toggle in the matrix **bypass** the daily-new cap (they're explicit opt-ins); they're born
  `new`, enter via "learn new" at your pace, and never flood today's due pile. Rationale: the
  new-cap throttles the *reading firehose* of brand-new words, not deliberate enrichment.
- **Caps are per *mode*** (recognition / production), not per skill. Today the New/Review caps are
  passive-only (active uncapped) — so recognition is already capped and production isn't; per-mode
  just makes that explicit and lets production get its own (optional) cap. **No per-skill caps** —
  3–5 knobs nobody tunes. If pronunciation ever crowds out meaning within the recognition cap, the
  lever is a *fair round-robin interleave across skills under the one cap*, kept as a roadmap
  tuning knob, not a new cap.

---

## Worked examples (keep these as test fixtures)

1. **"caveat" (English), meaning + pronunciation.** Term `caveat`. Facets:
   `(meaning_recognition,'')` ready; user enables `(pronunciation,'')` — Wiktionary has en IPA, so
   it's ready and joins the **passive** queue with an audio chip on the front, IPA on the back, its
   own schedule. Both due today → they're siblings → spacing keeps them apart in the session.
   Budget = 2 distinct facets.

2. **"être" with three forms (the bug this replaces).** Highlighting "je suis", "nous sommes",
   "vous êtes" all dedupe to ONE term `être` (unique `(user_id, target_language, headword, sense)`),
   with `cards.surface_form ∈ {suis, sommes, êtes}` and `user_lookups.count=3` (the `×3` badge).
   *Today:* `grammar.studied_form` is a **single slot** (last-write-wins) and `study_form_enabled`
   is **term-global** → only one form is study-able and toggling it shows the wrong form (the
   observed bug). *New model:* each form is its own facet `(meaning_recognition,'suis')`,
   `(meaning_recognition,'sommes')`, `(meaning_recognition,'êtes')` — separate rows, separate
   schedules, no shared slot, bug class gone. Spacing keeps suis/sommes/êtes non-adjacent in a
   session.

3. **"houses" encountered later (candidate-form suggestion).** Mon: highlight "house" → term,
   citation only. Tue: read a text with "houses" → a `cards` row with `surface_form='houses'` is
   written against the same term (you toggled nothing). The term now *has* an encountered form. The
   "+ Add a form" picker sources candidates from
   `SELECT DISTINCT surface_form FROM cards WHERE user_lookup_id=$1 AND status='kept' AND
   normalize(surface_form) <> normalize(headword)` — the same data behind the `×N` badge. It shows
   only the **string** (a card row stores nothing else); translation/morphology/pronunciation for
   the form are generated by **Opus** on enable (`pending_data` → confirm). Decision: surface
   encountered forms **on demand in the picker (option b)**, not as auto-added chips.

4. **Russian стол / стола́ (form pronunciation = roadmap, "un-enableable").** Structurally
   `(pronunciation,'стола')` is free, but rendering its back needs per-form stress/IPA, which
   `grammar.ipa` (lemma-level) doesn't have. So the `pronunciation` skill is **offerable on the
   citation only** in the early phases; on a form it renders as a **disabled/greyed chip cell**
   ("needs per-form pronunciation data"). Sourcing per-form stress is an enrichment task — roadmap.

5. **Budget non-competition.** "350 pronunciation due + 200 production due" is **not** a
   distribution problem: pronunciation is recognition (pool `passive`), production is `active` —
   different sessions, each its own per-mode cap. Within a mode you do the most-overdue first
   (spaced), the tail rolls over as normal SRS backlog. No quota math.

6. **Paradigm-add (roadmap).** In the term view, "+ Add a form" can open a **generated
   declension/conjugation table** (Opus); the user ticks slots (e.g. genitive plural → столо́в);
   each ticked slot becomes a `(skill, target_form)` facet with Opus-generated data, `pending_data`
   → confirm. Needs no schema change — `target_form` is a free normalized string with no highlight
   dependency.

---

## Target schema (Phase 1)

```sql
CREATE TABLE public.study_facets (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_lookup_id uuid NOT NULL REFERENCES public.user_lookups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,            -- denormalized, immutable on user_lookups
  target_language text NOT NULL,    -- denormalized (due-summary/budget group by it)

  skill text NOT NULL CHECK (skill IN ('meaning_recognition','meaning_production')),  -- widened to add 'pronunciation' in Phase 4
  target_form text NOT NULL DEFAULT '',   -- '' = citation/lemma; else normalized inflected form

  srs_state public.srs_state NULL,  -- NULL = unseen (same semantics as today)
  srs_due timestamptz, srs_stability real, srs_difficulty real,
  srs_last_review timestamptz,
  srs_reps int NOT NULL DEFAULT 0, srs_lapses int NOT NULL DEFAULT 0,

  leech_parked_at timestamptz,
  leech_rehab_correct_days int NOT NULL DEFAULT 0,
  leech_rehab_last_correct_on date,

  introduced_at timestamptz,        -- replaces user_lookups.added_to_practice_at; daily-new count reads this
  payload jsonb NOT NULL DEFAULT '{}',  -- form facets: {form, translation}; citation/pronunciation: {}
  data_status text NOT NULL DEFAULT 'ready' CHECK (data_status IN ('ready','pending_data')),  -- Phase 4 uses pending_data; default ready preserves P1 behavior
  source text NOT NULL DEFAULT 'system' CHECK (source IN ('system','highlight','paradigm','manual')),  -- form provenance (Phase 4+)
  disabled_at timestamptz,          -- disable ≠ delete: SRS history kept on re-enable

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),  -- app writes NOW() in every UPDATE; no DB trigger (matches processing-jobs/cards/prefs convention)

  UNIQUE (user_lookup_id, skill, target_form)
);
-- RLS enabled, service-role only, no policies (matches practice_rating_events convention)
```

Indexes (replace the dropped `user_lookups` partials — see Trap 11 on auto-drop):
- `(user_id, target_language, skill, srs_due) WHERE srs_state IS NOT NULL AND disabled_at IS NULL` (due scans)
- `(user_id, target_language, skill, srs_due ASC NULLS LAST, user_lookup_id)` (vocab due-sort cursor)
- `(user_id, target_language, skill) WHERE leech_parked_at IS NOT NULL` (parked counts)

**Row-existence semantics** (identical philosophy to today): every practice-visible term (`count>0`)
gets a `(meaning_recognition,'')` facet eagerly on keep; a `(meaning_production,'')` facet exists
only once production is enabled. `srs_state IS NULL` = unseen. **Soft-deleted terms keep their
facet rows** so restore resumes the schedule (verified: `softDeleteChunk`/`restoreChunk` only touch
`deleted_at`; `applyKeepTransition`/`applyUnkeepTransition` never touch `srs_*`).

**Why `target_form` joins the unique key now (not "later" like the old plan's escape hatch):** the
*être* example proves the form target is multi-instance per term from day one. `target_form=''` for
all singletons keeps citation facets clean; form facets key on the normalized surface string.

---

## Phase 1 — behavior-preserving cutover (1 PR, the big one). No UI change.

**Migration** (`supabase migration new create_study_facets_cutover`), one transaction, in order:
1. CREATE TABLE + indexes + RLS (above; `skill` CHECK is the 2-value form here).
2. Backfill `(meaning_recognition,'')` rows from `srs_*`/`leech_*`/`added_to_practice_at`. **Do NOT
   filter on `count` or `deleted_at`** (drops recoverable history — Trap 2). Backfill for every row
   that is practice-visible OR carries any non-default SRS/leech state — the predicate must cover
   **every** source column so a row with only `srs_stability`/`srs_difficulty`/`srs_last_review`
   set (theoretically decoupled from `srs_state`, but assert never assume) is still migrated:
   `WHERE count > 0 OR srs_state IS NOT NULL OR srs_due IS NOT NULL OR srs_stability IS NOT NULL OR
   srs_difficulty IS NOT NULL OR srs_last_review IS NOT NULL OR srs_reps <> 0 OR srs_lapses <> 0 OR
   leech_parked_at IS NOT NULL OR leech_rehab_correct_days <> 0 OR
   leech_rehab_last_correct_on IS NOT NULL OR added_to_practice_at IS NOT NULL`. Copy ALL of
   `srs_{state,due,stability,difficulty,last_review,reps,lapses}` + `leech_*`; map
   `added_to_practice_at → introduced_at`. `target_form=''`, `disabled_at=NULL`.
3. Backfill `(meaning_production,'')` rows analogously from `active_srs_*`/`active_leech_*` (full
   column set incl. `active_srs_{stability,difficulty,last_review}`):
   `WHERE learning_mode = 'active' OR active_srs_state IS NOT NULL OR active_srs_due IS NOT NULL OR
   active_srs_stability IS NOT NULL OR active_srs_difficulty IS NOT NULL OR
   active_srs_last_review IS NOT NULL OR active_srs_reps <> 0 OR active_srs_lapses <> 0 OR
   active_leech_parked_at IS NOT NULL OR active_leech_rehab_correct_days <> 0 OR
   active_leech_rehab_last_correct_on IS NOT NULL`. **Set `disabled_at = now()` on production facets
   where `learning_mode <> 'active'`** (Trap 15) — these are *demoted* terms whose `active_srs_*`
   was preserved; their production facet must exist (history) but stay disabled so Phase 3's
   "enabled facet ⇒ in production" doesn't resurrect them. Active members get `disabled_at = NULL`.
4. **Parity assertion before the DROP** — a `DO $$ … RAISE EXCEPTION` block aborting the tx unless
   **every migrated column matches per source row**, not just counts/sums (Trap 3). Per facet
   family, assert with a full-row diff: e.g.
   `SELECT count(*) FROM user_lookups ul JOIN study_facets f ON f.user_lookup_id=ul.id AND
   f.skill='meaning_recognition' AND f.target_form='' WHERE ul.srs_state IS DISTINCT FROM f.srs_state
   OR ul.srs_due IS DISTINCT FROM f.srs_due OR ul.srs_stability IS DISTINCT FROM f.srs_stability OR …
   (all 7 srs + 3 leech + introduced_at)` must be 0; and the reverse — no source-qualifying row
   lacks a facet. Same for the production family. Migration is one transaction → any mismatch rolls
   back the whole thing rather than dropping columns against bad data.
5. DROP from `user_lookups`: `srs_*` (7), `active_srs_*` (7), `leech_parked_at`, `leech_rehab_*`(2),
   `active_leech_*`(3), `added_to_practice_at`. **Keep `learning_mode` for now** (dropped in
   Phase 3 once "active" dissolves — keeping it one phase lets P1 stay purely mechanical). Postgres
   auto-drops the dependent indexes with their columns (Trap 11) — explicit `DROP INDEX` redundant;
   if listed, `IF EXISTS` + before the column drops.

**Regenerate DB types** (`pnpm --filter @flicktionary/backend db:dev:tunnel:gen-types`). **gen-types
is NOT a complete safety net** (Trap 1): `SELECT_CHUNK_ROW_SQL` selects `ul.srs_due` etc. as raw SQL
strings → dropping columns = **runtime** error, not compile error. Pair with an explicit sweep:
`rg "srs_|active_srs|leech_|added_to_practice_at|learning_mode" apps/backend --type ts` and repoint
every SQL-string site. Known raw-SQL sites: `SELECT_CHUNK_ROW_SQL`, `listReviewTerms`,
`listDueSummary`, `listVocabularyForLanguage`, `listKeptChunksForExport`, and every
`parkLeech`/`rehab`/`init`/`applyFsrs` UPDATE.

**New repository** `apps/backend/src/transport/database/study-facets/study-facets-repository.ts`:
`getFacet(userLookupId, skill, targetForm, executor?)`, `upsertFacet`, plus the moved SRS writers.
postgres.js sql-template + `executor?: postgres.Sql` pattern used everywhere.

**Rewrite in `user-lookups-repository.ts`** (all pool→column-family branching collapses to facet-row
addressing on `(user_lookup_id, skill, target_form)`; in P1 only `skill ∈ {meaning_recognition,
meaning_production}`, `target_form=''`). Map `pool` at the service boundary: `passive→
skill='meaning_recognition'`, `active→skill='meaning_production'`.
- `initializeSrsStateIfUnderDailyCap` (`user-lookups-repository.ts:638`) — keep advisory lock
  `flashcards:{userId}:{lang}`; the COUNT-today predicate now counts `study_facets` with
  `skill='meaning_recognition' AND target_form='' AND introduced_at >= CURRENT_DATE`, joined back to
  `user_lookups` for `count>0 AND deleted_at IS NULL` (Trap 7).
- `applyFsrsResultForPool`, `restoreSrsSnapshotForPool` (`:764`) → facet-addressed; undo:
  `wasIntroduction` clears the facet's `introduced_at`; `causedParking` clears the facet's leech
  cols (Trap 8).
- `parkLeech`, `advanceRehabDay`, `unparkAndSoftReentry`, `listParkedTerms`.
- `setLearningMode` (`:824`) — on promote, ensure the `meaning_production` facet row exists (NULL
  state); on a real mode change, reset **that facet row's** leech cols. (Becomes
  `setFacetEnabled('meaning_production', …)` in Phase 3; keep as `setLearningMode` for P1.)
- `applyKeepTransition` (`:293`) creates the `(meaning_recognition,'')` facet row alongside the
  count bump — **atomically** (Trap 17). Today `set-card-status.ts:53-67` does
  `updateStatus` → `applyKeepTransition` → `setLearningMode` as *separate awaited calls*, and
  `applyKeepTransition` only touches `count`/`deleted_at`. Once a queueable facet is *required* on
  keep, a failure between the status flip and facet creation leaves a kept term with no facet (a
  word that's "in vocabulary" but can never appear in practice). Fix: do the count bump + facet
  upsert in one `beginTx`, and make facet creation **idempotent** (`ON CONFLICT (user_lookup_id,
  skill, target_form) DO NOTHING`) so a re-keep / repair pass is safe. Add a defensive
  `ensureCitationFacet(userLookupId)` repair the practice fetch can call if it ever finds a
  `count>0` term lacking its recognition facet.
- `listDueSummary` — FILTER aggregation rewritten as grouped joins over `study_facets` (recognition
  numbers from `skill='meaning_recognition'`, active mirrors from `skill='meaning_production'`,
  `newIntroducedTodayCount` from recognition `introduced_at`).
- `listReviewTerms` (`:427`) — the three sub-selects (review / learning / new) join `study_facets`
  (`f.skill = <mapped>`, `f.target_form=''` in P1, state/due/parked off `f.*`); active keeps an
  implicit single-skill filter. Return `ul.* + aliased facet cols` as `DbUserLookupWithFacet`.
- `listChunksForLanguage` — LEFT JOIN the recognition + production citation facet rows; map
  `srsState/srsDue/srsReps` from recognition, `activeSrs*` from production. **Due-sort cursor**: the
  two-phase keyset (`srs_due` then `id`, NULLS-LAST tail) moves onto the joined recognition facet's
  `srs_due` — scheduled phase INNER, unscheduled tail LEFT (Trap 6).
- `listVocabularyForLanguage`, `listKeptChunksForExport` (`isLeechParked` = OR over both citation
  facets' `leech_parked_at`).

**Service edits** (verified set; the `rg` sweep is the backstop): `fsrs.ts`
(`userLookupToFsrs(row,pool)` → `facetToFsrs(facetRow)`; 24h floor keys on the facet's review mode =
recognition), `rate-term.ts` (`:97` — fetch the facet row; `introducedNew = facet.srs_state==null`;
the events insert is unchanged in P1 — it still stores `pool`), `leech-config.ts`
(`isParked(facet)`/`shouldParkLeech(facet,result)`), `rehab.ts` (`:29` reads the facet row not the
lookup), `exercise-bank.ts` (`:~292` `rehabCorrectDaysFor` at the facet row),
`advance-reading-text.ts` (facet row; membership stays on `learning_mode` in P1),
`practice-router.ts` (`toReviewTermDto` reads `srsState` off the joined facet — serialization only),
`review-caps.ts` (`:68` — reads the same per-language limits; unchanged in P1).

**Undo across the cutover (no event backfill):** pre-cutover `practice_rating_events` carry
family-agnostic `prev_srs_*` + `pool`; `restoreSrsSnapshotForPool(pool)` writes them into the
`(lookup, skill=mapped(pool), target_form='')` row — semantically identical. Test explicitly
(Trap 8).

**No contract or frontend changes. Zero user-visible change.**

**Tests:** rewrite mocked-repo unit tests to drive facet rows (`fsrs`, `leech-config`, `rate-term`,
`undo-rating`, `rehab`, `advance-reading-text`, `list-review-terms`, `build-vocabulary-csv`); add
`study-facets-repository` tests.

**Docs:** SRS.md §1 ("one row, two pools" → term + facet rows; new column table) and SPEC.md's
pool/data-model paragraphs.

---

## Phase 2 — plumbing generalization (1 PR). Still no UI change (wire `pool` unchanged).

**Migration** (`add_facet_identity_to_rating_events`): add **`skill` and `target_form`** columns to
`practice_rating_events` (do NOT overload `pool` — Trap 4; `pool` keeps meaning "which session
queue produced this rating"). Backfill `skill = CASE pool WHEN 'active' THEN 'meaning_production'
ELSE 'meaning_recognition' END`, `target_form=''` for existing rows. Add index
`(user_lookup_id, skill, target_form, rated_at DESC) WHERE reverted_at IS NULL` for undo lookup.

**Facet identity through rate/undo** (Trap 3 — critical): today `rateTerm`/`undoRating` carry only
`userLookupId + pool`, and `findLatestLiveEventForUndo` keys on `(user_id, user_lookup_id, pool)`.
Once the passive queue serves recognition + pronunciation + forms, that addresses the wrong card.
- `ReviewTermSchema` (`flicktionary-schemas.ts:468` — has **zero** facet identity today, not even
  `pool`) gains `skill` + `targetForm` (+ `facetPayload`, nullable) — the client holds the queue
  item, so it knows each card's identity. `ReviewTermAnnotationSchema` (the reading-advance batch,
  same file ~:482) gains them too.
- `rateTerm` input gains `skill` (default `meaning_recognition`) + `targetForm` (default `''`);
  `undoRating`/rerate likewise. `rateTerm` writes `skill`/`target_form` onto the event row;
  `applyTermRating` addresses the `(lookup, skill, target_form)` facet.
- `findLatestLiveEventForUndo` keys on `(user_id, user_lookup_id, skill, target_form)`;
  `restoreSrsSnapshotForPool` → `restoreSrsSnapshotForFacet`.
- **Validate legal `(pool, skill)` pairs** server-side (see The model). `pool` stays the queue.
- **Client wiring (Trap 7 — be exhaustive, not just the schema):** `flashcard-mode-view.tsx:186`
  currently sends `{ userLookupId, rating, pool, learnNewSession }` — add `skill`/`targetForm` from
  the queue item; the same for the rerate-edit and undo call sites and any **local optimistic
  rating record** the queue keeps (so an in-flight redrill/undo addresses the right facet, not
  `userLookupId+pool`). Update query-invalidation keys if they include identity. After every
  contract edit: `pnpm --filter @flicktionary/api-client build` (Trap: backend reads stale `.d.ts`).

**Per-mode caps + budget = distinct facets:**
- `countReviewBudgetConsumedToday*` (`practice-rating-events-repository.ts:145`) →
  `COUNT(DISTINCT (user_lookup_id, skill, target_form))`, scoped by **mode** (recognition =
  `skill IN ('meaning_recognition','pronunciation')`, production = `skill='meaning_production'`)
  rather than `pool=...`. meaning + pronunciation of one term = 2 slots; in-session redrill = 1.
- Caps become per-(language, **mode**). Storage: add production-mode caps to
  `user_target_language_prefs` (append-only **nullable** columns, e.g.
  `practice_max_new_terms_active`, `practice_max_review_terms_active`; recognition reuses the
  existing `practice_max_new_terms`/`practice_max_review_terms`). **Default NULL = the hard ceiling
  (uncapped), preserving today's active behavior** (Trap 20) — `review-caps.ts:49-66` currently
  returns `HARD_MAX_*` for the active pool, so production must NOT inherit/copy passive's numeric
  caps or it becomes a silent behavior change. `getPracticeLimitsForLanguage`
  (`user-target-language-prefs-repository.ts:65`) returns both modes (NULL→hard-ceiling);
  `review-caps.ts` resolves per mode. (UI for the new production caps ships in Phase 3; until then
  production stays effectively uncapped, exactly as now.)

**Queue composition + sibling spacing** (`listReviewTerms`, passive/recognition queue; Trap 5):
today the three sub-selects are **separately LIMIT-capped** — a post-hoc `DISTINCT ON`/spacing
applied after the caps would **underfill** buckets. Restructure: select across
`skill IN ('meaning_recognition','pronunciation')` + `disabled_at IS NULL` + `data_status='ready'`,
compute `rn = ROW_NUMBER() OVER (PARTITION BY user_lookup_id ORDER BY <priority>)` in an inner
query, **order the outer queue by `(rn, <priority>) so all rank-1 precede rank-2** (this is the
*spacing*, not a cap — keep all siblings, just never adjacent), THEN apply the bucket LIMITs.
Priority within a term: due-review > intraday-learning > unseen. Production queue unchanged (single
skill, single-instance citation in P2).

**Opt-in new bypass must hold at BOTH queue selection AND rating time** (Traps 5a, 18): define one
shared predicate `isDailyNewCappedFacet(skill, targetForm) = (skill === 'meaning_recognition' &&
targetForm === '')` — the citation recognition card is the *only* daily-new-capped facet.
- **Queue selection** (`listReviewTerms`): the new sub-select today applies one `newLimit` to ALL
  `srs_state IS NULL` rows. Split it: (a) citation-recognition new, capped by `newLimit`; (b)
  opt-in new (everything `isDailyNewCappedFacet=false`), **uncapped by daily-new** (hard ceiling
  only). Spacing applies across the merged result.
- **Rating time** (`rate-term.ts:93-104`): today every passive introduction routes through
  `initializeSrsStateIfUnderDailyCap`, which can return `daily_cap_reached`. If the queue serves an
  uncapped opt-in pronunciation/form facet but `rateTerm` still runs the cap guard, the first rating
  is **refused** — the card is unreviewable. Fix: when `isDailyNewCappedFacet(skill,targetForm)` is
  false, initialize the facet's `introduced_at` **without** the cap guard (reuse the existing
  `bypassCap` path that `learnNewSession` already uses at `:102`). Both still stamp `introduced_at`
  and feed the review-budget DISTINCT count thereafter.

**Leech parking + exercise-bank stay CITATION-MEANING-only** (Trap 19): `shouldParkLeech → true`
only when `target_form='' AND skill IN ('meaning_recognition','meaning_production')` — i.e. NOT for
form facets (even form-recognition) and NOT for pronunciation. Rehab-gate exercises test *meaning*,
and `practice_exercises` is keyed `(user_lookup_id, pool, status)` with **no facet identity**
(`migration 20260604163350:34,48`). Migrating the exercise bank to facet identity is out of scope
for these phases, so leeching MUST be constrained to citation meaning to avoid form/pronunciation
facets colliding on the pool-keyed bank. (Roadmap: migrate `practice_exercises` to
`(user_lookup_id, skill, target_form, status)` if/when form facets need their own rehab exercises.)

**Reading generator guard:** `generate-reading-text.ts` candidates filter to citation meaning facets
(`skill IN ('meaning_recognition','meaning_production') AND target_form=''`); verify
`advance-reading-text.ts` implicit-good can never rate a non-meaning / form facet.

**Frontend prep (no visible change yet):** `getCardFaceConfig(code, pool)`
(`packages/core/src/constants/card-face-config.ts:66`) gains a `skill`/`targetForm` awareness
(behavior identical for citation meaning); flashcard queue items carry `skill`/`targetForm`/
`facetPayload`; `review-counts.ts` keeps current display.

**Tests:** budget DISTINCT triple-counting; legal-pair rejection; sibling spacing (siblings present
but non-adjacent); opt-in-new bypass; meaning-only reading filter.

---

## Phase 3 — UI restructure + the "Study targets" control + per-mode caps UI (1 PR, the heavy UI one)

This is where "Active vocabulary" dissolves and all skill/target choices converge into one control.
**Still citation-only targets and meaning-only skills** (pronunciation is Phase 4) — the chip UI
debuts with the two meaning skills so the structure is in place before pronunciation/forms grow it.

**Migration** (`drop_learning_mode`): drop `user_lookups.learning_mode` (now derivable: a term is
"in production" iff a `meaning_production` facet exists). Repoint the few `learning_mode` readers
(`advance-reading-text.ts` membership, `listReviewTerms` active clause) at facet existence.

**Contract:** `chunks.setFacetEnabled({ userLookupId, skill, targetForm, enabled, payload? })` —
on `enabled:true`, **upsert**: create the facet (NULL srs state) if absent, else **clear
`disabled_at`** on the existing (possibly demoted, history-bearing) row — never lose its schedule.
On `enabled:false`, set `disabled_at` (keep SRS history — disable ≠ delete). `payload` optional,
carries `{form, translation}` for forms (Phase 4); design it now. Replaces `setLearningMode`
(promote of a previously-demoted term re-enables its preserved production facet, Trap 15; demote =
`enabled:false`). Carry the old `setLearningMode` active-leech-rehab reset (`:832-834`) onto the
production-facet leech cols when a real enable/disable flip happens.

**The Study-targets control** (new `study-targets-section.tsx` in
`apps/web/src/features/review/components/`): **chips per target** (Citation `<headword>`; forms in
Phase 4), each with an **edit pencil** (mirrors the language-picker edit affordance) opening a
**sheet of skill checkboxes** (squares / multi-select, NO search) — Recognition, Production,
(Pronunciation greyed until Phase 4). On desktop, swap the full sheet for an inline popover /
expand-in-place so editing isn't a dialog per cell. Chip fill state shows which targets have any
enabled skill. **Never render a literal N×M grid** (dies on mobile, explodes at 6 targets × 5
skills) — it's a chips + per-chip-skill-sheet list.

**Surface migrations** (move all facet choice into the one control):
- **`focus-view.tsx`** (`:471` `FocusActionBar`, `:397` "Switch to active vocabulary"): the bottom
  Reject/Passive/Active bar and the language-wide switch button are **removed**. Focus view becomes
  the **term view**: Study-targets chips at the top, the existing data editor below reflecting the
  **selected target** (Citation selected by default → shows the headword's data, as today). "Reject"
  becomes delete-term; production is a skill checkbox.
- **Responsive overlay / `vocabulary-action-drawer.tsx`**: "Switch to active vocabulary" + Delete →
  a Study-targets summary + Delete.
- **Triage** (`triage-row.tsx:100` dropdown "Keep as passive/active";
  `triage-list-view.tsx` batch): collapse to **Keep / Reject**. Keep defaults to enabling
  `(meaning_recognition,'')`. Drop the passive/active fork — it's a facet decision, set later in
  the term view. (Decided: no production quick-add at triage for now; "easy to modify later".)
- **Session gloss** (`session-gloss-sheet.tsx`): keep **Save** primary = save lemma + intend
  `(meaning_recognition,'')`, unchanged fast path. Add a **collapsed** "Study targets" affordance
  under Save that optionally pre-enables targets/skills before triage (progressive disclosure — the
  gloss already knows the lemma + that the selection is a form). The gloss's morph/form hint is
  **Haiku-grade preview only**; canonical form data is Opus-generated later (Phase 4), never trusted
  from the gloss.

**Per-mode caps UI** (`cefr-per-language-list.tsx:35` `PracticeLimitsRow`): render the
recognition + production New/Review caps (grouped by mode), wired to the Phase-2 storage. Relabel
the due count to **"reviews"** (`review-counts.ts` / `review-queue-stats.tsx` /
`practice-language-view.tsx:101`) — it now counts distinct facets, so card-level "reviews" is the
honest noun.

**Lingui** strings + `lingui compile`; api-client rebuild; SRS.md/SPEC.md.

---

## Phase 4 — form targets + pronunciation skill + generate-and-confirm (1 PR, or split 4a/4b)

**Migration** (`widen_skill_add_pronunciation`): widen the `study_facets.skill` CHECK to include
`'pronunciation'`. Widen the `practice_rating_events` skill values if constrained.

**Migration** (`migrate_study_form_to_form_facet`): for terms with
`grammar->>'study_form_enabled'='true'` **AND** a well-formed `grammar->'studied_form'->>'form'`
(non-empty — guard against empty/invalid payloads; rows failing the guard are left + `RAISE NOTICE`
counted, not silently migrated). **No `count`/`deleted_at` filter** (Trap 2/10). Insert a
`(meaning_recognition, <normalized form>)` facet with `payload={form, translation}` from
`studied_form`, `data_status='ready'`, NULL srs state, `source='highlight'`; then strip
`study_form_enabled` from grammar JSONB across all rows. `grammar.studied_form` **stays** as the
generation artifact.

**Pronunciation skill (citation only here):**
- `setFacetEnabled('pronunciation','',true)` creates `(pronunciation,'')`, ready **only when
  `pickIpa` returns a displayable bucket** (`packages/core/src/utils/pick-ipa.ts:14` returns
  `undefined` with no fallback — Trap 12). Payload `{}` — IPA derived at render via existing
  `pickIpa` + `englishIpaDialect`, so grammar edits stay live.
- Flashcards (`flashcard-mode-view.tsx`): `skill==='pronunciation'` → front = headword (ru:
  stress-stripped via `stripStressMarks`/`hideStressOnFront`) + an audio chip (lucide `Volume2` +
  Lingui label, not a raw emoji), back = IPA + stressed `display_form`. Self-graded; passive queue.
- **IPA-vanished case** (precondition disappears): if the IPA is later removed so `pickIpa` returns
  nothing for an already-scheduled pronunciation facet, **delete the facet** (decided: "delete like
  now" over rehab — rehab gates test meaning, nothing to rehab a soundless pronunciation with).
  Implement as a render-time / sync guard.

**Form targets (recognition + production):** chips list now includes encountered forms from
`cards.surface_form` (Worked example 3 query) and a **"+ Add a form"** entry. Enabling a form skill:
- `(meaning_recognition,'<form>')`: front = `payload.form` (+ translation, ru stress-stripping like
  today's studied_form cards), back = translation. **Delete the old grammar-key-driven front swap
  from the citation card path.**
- `(meaning_production,'<form>')`: front = meaning/spec, back = the form.
- New form facets are born `data_status='pending_data'` and trigger an **Opus** generation pass
  (the *better* model — never the Haiku gloss) filling `payload` (form spelling, translation,
  morphology). **Generate-and-tag** is the new default (move off Wiktionary-only), but
  **pronunciation generation is confirm-gated** (IPA/stress is where LLMs hallucinate; wrong Russian
  stress drilled as truth is worse than no card) — meaning/examples may auto-fill, pronunciation
  needs explicit user confirm before leaving `pending_data`. A facet in `pending_data` is enabled
  but NOT queued; the chip shows "needs data: generate / enter manually".

**Normalization (`target_form` keys) needs a real shared implementation** (Trap 21): `stripStressMarks`
is currently a one-line local in `flashcard-mode-view.tsx:40` (`text.replace(/́/g,'')`), not
shared. Before any code writes a `target_form` key, define a single
`normalizeTargetForm(text, langCode)` in `packages/core` (NFC + trim + casefold + strip combining
stress U+0301; lang-aware) and use it on **every** write path (form enable, payload edit, the
candidate-suggestion `DISTINCT` in Worked example 3) so keys are consistent. Replace the local
`stripStressMarks` with it. The Phase-4 `migrate_study_form_to_form_facet` migration must apply the
**SQL equivalent** when keying the migrated form (`lower(trim(normalize(regexp_replace(form,
'́','','g'), NFC)))` — verify Postgres `normalize()`/`unaccent` availability on the dev-tunnel
stack and pin the exact expression so it matches the TS normalizer byte-for-byte). `payload` keeps
the full display form (stress intact). Consequence: `стола`/`стола́`/`Houses`/`houses` collapse to
one key — correct, same form.

**Remove** `study_form_enabled` from `GrammarSchema` (flicktionary-schemas.ts), and the Switch +
debounced translation input from `editable-card-fields.tsx:64-164` (their function moves into the
Study-targets "form" sheet as `setFacetEnabled` + a `setFacetPayload` patch path);
`materialize-basic-data-chunks.ts` `buildStudiedFormPatch` never-overwrite guard repoints at
form-facet existence.

api-client rebuild; lingui compile; SRS.md/SPEC.md.

---

## Roadmap (deliberately vague — own plan session each)

- **Form pronunciation (Russian stress):** the `(pronunciation,'<form>')` cell — un-enableable until
  **per-form stress/IPA enrichment** exists. Smaller task once the model + generate-and-confirm
  pipeline are in place.
- **Paradigm-add:** "+ Add a form" → Opus-generated declension/conjugation table → tick slots →
  facets with `source='paradigm'`, Opus-generated, confirm-gated (Worked example 6).
- **Encountered-form nudge:** option (a) — proactively surface newly-encountered forms on words you
  already study (we chose option (b) on-demand for now).
- **Fair-interleave under a mode cap:** only if pronunciation/forms starve meaning within the
  recognition cap.
- **Grammar patterns / "constructions"** ("soit…soit…", subjunctive after *bien que*): a second
  axis — *what kind of item is it* (`kind: lexical | pattern` on `user_lookups`) — orthogonal to
  the target×skill axes here. Pattern enrichment, pattern templates, pattern exercises (mc_cloze
  over fixed tokens, multi-blank production_cloze, morphology-constrained slots). Suppress
  auto-cloze for patterns until templates exist.

## Out of scope (no roadmap phase)

Auto-created pronunciation facets per language pref. TTS / audio-graded production. Per-facet leech
rehab exercises. CSV facet tags. LLM auto-detection of pattern highlights.

---

## Traps / risk register (skim before each phase — these are the expensive mistakes)

1. **gen-types is only a partial safety net** (P1): catches TS property reads, MISSES raw-SQL column
   refs (`SELECT_CHUNK_ROW_SQL` et al. fail at *runtime*). Pair with the `rg "srs_|active_srs|leech_|
   added_to_practice_at|learning_mode"` sweep.
2. **Backfill must not drop recoverable history** (P1, P4): unkeep/soft-delete leave `srs_*` intact;
   backfill on state-presence, NOT `count>0 AND deleted_at IS NULL`. Same rule for the studied_form
   migration (a soft-deleted toggled term must keep its form on restore).
3. **Facet identity through rate/undo** (P2): rate/undo + `practice_rating_events` need `skill` +
   `target_form` columns; else the multi-facet passive queue rates/undoes the WRONG card.
4. **Don't overload `practice_rating_events.pool`** (P2): add `skill`+`target_form`; `pool` stays the
   session-queue meaning.
5. **Sibling-spacing underfill** (P2): bucket LIMITs are per sub-select; rank-and-reorder for spacing
   BEFORE capping, not `DISTINCT ON`/spacing after. Spacing keeps all siblings (non-adjacent), it is
   NOT a per-term cap (that was the old single-axis plan's "bury").
   - **5a. Opt-in new starvation** (P2): split the new bucket — citation-meaning-recognition capped
     by `newLimit`; everything opt-in uncapped by daily-new (hard ceiling only), at QUEUE SELECTION.
   - **5b. Illegal `(pool, skill)` pairs** (P2): validate server-side (passive↔{meaning_recognition,
     pronunciation}; active↔meaning_production).
6. **Vocabulary due-sort cursor** (P1): two-phase keyset moves onto the joined recognition citation
   facet; scheduled phase INNER, unscheduled tail LEFT; page across the boundary.
7. **Advisory lock + daily-new count** (P1): lock key `flashcards:{userId}:{lang}` unchanged; counted
   table moves to the recognition citation facet's `introduced_at`; keep `count>0/deleted` guards via
   join-back to `user_lookups`.
8. **Undo across the cutover** (P1): pre-cutover events (family-agnostic `prev_srs_*` + `pool`) must
   restore into `(lookup, skill=mapped(pool), '')`; test with an event inserted against the old shape.
9. **Budget counting** (P2): `COUNT(DISTINCT (user_lookup_id, skill, target_form))` scoped by mode —
   meaning + pronunciation of one term = 2 slots; redrill of one facet = 1.
10. **studied_form migration ordering** (P4): insert form facets BEFORE stripping
    `study_form_enabled`, same migration/PR; guard on non-empty `studied_form.form`.
11. **Index auto-drop** (P1): Postgres drops dependent indexes with their columns; explicit
    `DROP INDEX` redundant — if used, `IF EXISTS` + before column drops.
12. **`pickIpa` returns `undefined`, no fallback** (P4): a citation pronunciation facet is offerable
    only when `pickIpa` yields a bucket; an already-scheduled pronunciation facet whose IPA later
    vanishes is **deleted** (decided), not left rendering an empty back.
13. **`pool` is NOT a third axis** (all phases): it's the derived review mode and stays on the wire
    unchanged. The two confusing shared words — "passive"/"active" as *pool* (a queue) vs the *skills*
    they map to — are distinct namespaces; don't conflate `pool` (routing) with `skill`+`target_form`
    (identity). Rename internal params to `skill`/`targetForm` only where they address a row.
14. **Haiku gloss ≠ canonical data** (P3/P4): the gloss's form/morph hint is a fast preview;
    stored form data is Opus-generated on enable. Never persist Haiku gloss output as a card payload.
15. **Demoted-active resurrection** (P1/P3): demotion preserves `active_srs_*`
    (`user-lookups-repository.ts:814-816`). Backfill a production facet from that history but
    **set `disabled_at`** when `learning_mode <> 'active'`; "in production" = enabled facet, not
    facet existence. Promote clears `disabled_at`, demote sets it.
16. **Sibling spacing is best-effort, not guaranteed** (P2): a dominating term's high-rank siblings
    have no separator and go adjacent at the tail. Accept it; test "one term, two facets" + uneven
    counts. Don't claim/assert a guaranteed gap.
17. **Keep must be transactional** (P1): `set-card-status.ts:53-67` is sequential awaits;
    `applyKeepTransition:293` only does count/deleted. Wrap count-bump + idempotent facet upsert
    (`ON CONFLICT DO NOTHING`) in one tx; add an `ensureCitationFacet` repair path.
18. **Opt-in cap bypass at RATING time too** (P2): `rate-term.ts:93-104` runs the daily-cap guard on
    every passive intro. Gate it with `isDailyNewCappedFacet` (= citation recognition only) so
    uncapped pronunciation/form facets aren't refused on first rating (reuse `bypassCap`).
19. **Leech/exercise identity stays citation-meaning-only** (P2+): `practice_exercises` is pool-keyed
    with no facet identity (`migration 20260604163350:34,48`). `shouldParkLeech → true` only for
    `target_form='' AND skill IN ('meaning_recognition','meaning_production')`; form/pronunciation
    facets never leech (else they collide on the pool-keyed bank). Migrate the bank to facet
    identity only if/when form rehab is wanted (roadmap).
20. **Production cap defaults = NULL/hard-ceiling** (P2): active is uncapped today
    (`review-caps.ts:49-66`). New production cap columns default NULL→hard-ceiling; never copy
    passive's numbers, or it's a silent behavior change.
21. **`target_form` normalizer must be shared** (P4): `stripStressMarks` is local to a web component
    (`flashcard-mode-view.tsx:40`). Build `normalizeTargetForm` in `packages/core`, use on every
    write path, and pin a byte-identical SQL equivalent in the studied_form migration.

---

## Verification (each phase)

Workspace gates: `pnpm check:types`; backend unit tests; `lingui compile` when strings change;
`pnpm --filter @flicktionary/api-client build` after contract edits (backend reads stale `.d.ts`
otherwise); regen DB types when columns change. Dev stack = supabase-dev-tunnel (port 34322),
secrets via Doppler `dev_personal`. Migrations are append-only via `supabase migration new` from the
dev-tunnel stack.

- **Phase 1 golden paths** (manual, dev-tunnel): parity check runs *inside* the migration
  (`RAISE EXCEPTION` before the DROP) — also run the diff by hand before applying. Then: keep →
  introduce → rate → undo → re-rate; learn-new batch bypass; leech park → strengthen → graduate;
  reading advance implicit-good; vocabulary due-sort paging; active promote/demote rehab reset;
  **demote an active term → its production facet is backfilled DISABLED, not queued; re-promote →
  re-enabled with the preserved schedule** (Trap 15); CSV export tags; **soft-delete a scheduled
  term → restore → schedule + leech intact** (recoverable history). The migration's all-column
  parity assertion (Trap 3) must pass before the DROP — also run the per-column diff by hand first.
- **Phase 2:** flashcard sessions behave identically; review budget refunds on undo; siblings are
  spaced when separators exist (test "one term, two facets" and uneven sibling counts — tail
  adjacency is acceptable, no crash/loop); opt-in-new isn't starved by a spent meaning new-cap **and
  a pronunciation/form facet can be rated even after the citation daily-cap is exhausted** (the
  rating-time bypass, Trap 18); production stays uncapped (NULL caps → hard ceiling); illegal
  `(pool,skill)` rejected; rate/undo/rerate from the flashcard view carry `skill`/`targetForm`.
- **Phase 3:** Study-targets chip + skill-sheet on desktop and mobile; production enable/disable from
  it (disable keeps SRS); triage Keep/Reject; gloss fast Save unchanged + optional targets; per-mode
  caps save and apply; due count labelled "reviews".
- **Phase 4:** an English term with IPA → enable pronunciation → passive queue card with audio chip,
  IPA on flip, own schedule; disable → gone; re-enable → schedule resumed; IPA removed → facet
  deleted. A previously-toggled *être* shows a fresh form card AND a headword-front meaning card;
  three forms of one verb are three separate form facets, spaced in a session; basic-data generation
  proposes studied_form candidates without clobbering an existing form facet; a form's missing data
  sits `pending_data` (not queued) until Opus-generated and (for pronunciation) confirmed.
