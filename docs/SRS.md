# How the SRS works

The **single authoritative spec** for the practice/SRS system (web app): data model,
scheduler, budgets, queues, reading mode, parking/exercises, and the practice UI surfaces.
`SPEC.md` carries only a summary + pointer here. Describes current behavior. Update this
doc alongside behavior changes — same convention as `apps/extension/EXTENSION-SPEC.md`.

Code map:

- Scheduler: `apps/backend/src/service/practice/fsrs.ts` (`ts-fsrs` wrapper)
- Rating flow: `rate-term.ts` (`applyTermRating`, `rateTerm`); undo: `undo-rating.ts`
- Queue: `list-review-terms.ts` + `listReviewTerms` in `user-lookups-repository.ts`
- Composed queue: `compose-practice-queue.ts` (+ `warmup-parking.ts` for the shared parking passes)
- Daily budgets: `review-caps.ts` (`resolveReviewCaps`, `clampPracticeSessionLimits`)
- Leeches: `leech-config.ts`, `rehab.ts`, `exercise-bank.ts`
- Reading mode: `generate-reading-text.ts`, `advance-reading-text.ts`
- Audit log: `practice-rating-events-repository.ts`
- Frontend session: `apps/web/src/features/practice/components/composed-practice-view.tsx`

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
| Daily caps | new + review budgets | **none** (hard ceilings only) |
| Stamps `introduced_at` on introduction | yes | no |
| Counts toward review budget | yes | no |
| 24h interval floor | yes | no |
| Card layout | headword front | prompt front (`ACTIVE_CARD_FACE_CONFIG`) |

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
- `introduced_at` (on the citation recognition facet) is the source of truth for the daily-new
  count; it replaces the old `user_lookups.added_to_practice_at`.
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
  live. A form facet's payload carries its own `grammar.ipa` bag (English → the user's dialect
  bucket, others → `untagged`).

### Form facets

A `(meaning_recognition | meaning_production, '<form>')` facet drills a **specific inflection** of
a term (e.g. `(meaning_recognition, 'стола')`) on its own independent schedule. `grammar.studied_form`
stays as a write-only generation artifact; its never-overwrite gate is **form-facet existence**
(`hasFormFacet`).

- **Key normalization** — `target_form` is normalized on every write path by
  `normalizeTargetForm(text)` (`packages/core/utils/normalize-target-form.ts`: strip combining
  acute U+0301 → NFC → trim → lowercase) so `стола`/`стола́`/`Houses`/`houses` collapse to one key.
  The SQL twin (`lower(trim(normalize(regexp_replace(form, U+0301, '', 'g'), NFC)))`) is pinned
  byte-for-byte in the migration and the candidate query. `payload` keeps the **full
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
   `createEmptyCard(now)`.
2. Runs `fsrs.next()` and persists `state/due/stability/difficulty/last_review/reps/lapses` on
   the facet (`applyFsrsResultForFacet`).
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

Caps are **per review mode** (recognition / production), not per skill. Production gets an
optional **review** cap only — `practice_max_review_terms_active` (nullable; **NULL = uncapped
= hard ceiling**, the default). The settings UI
(`cefr-per-language-list.tsx`) surfaces it: a Recognition group {New, Review} and a
Production group {Review only}, where an empty Production-review input means uncapped (NULL).
Production has **no** new cap: the citation recognition card is the only daily-new-capped facet,
so production-new is uncapped by design (`isDailyNewCappedFacet`).

Daily budgets:

- **New budget** (recognition only) = limit − count of citation-recognition facets with
  `introduced_at` = today. Consumed by introductions (first citation-recognition rating), from
  flashcards AND reading mode.
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

## 4. The queue (listReviewTerms)

Scopes: `mixed` (due first, then new), `review_due` (due only), `learn_new` (new only).
The query serves the pool's **skill set** (passive = `{meaning_recognition, pronunciation}`,
active = `{meaning_production}`), filtered to enabled (`disabled_at IS NULL`) and ready
(`data_status='ready'`) facets. It is four sub-selects, each separately capped, then spaced:

| bucket | predicate | cap | order |
|---|---|---|---|
| review-state | `srs_state IN ('new','review')`, due | remaining **review budget** | due ASC |
| learning-state | `srs_state IN ('learning','relearning')`, due | hard max only | due ASC |
| new (capped) | `srs_state IS NULL`, **primary citation** facet | remaining **new budget** | created_at ASC |
| new (opt-in) | `srs_state IS NULL`, **NOT** primary citation | hard ceiling, **`learn_new` only** | created_at ASC |

The **primary citation** facet is the pool's daily-new-capped card (passive →
`(meaning_recognition,'')`, active → `(meaning_production,'')`). **Opt-in new** facets
(pronunciation/forms) bypass the daily-new cap but are served **only in `learn_new`**,
never `mixed` — otherwise the primary Practice button would flood a session with every
enabled-but-unseen facet. `resolveReviewCaps` enforces this (it returns `maxOptInNewTerms=0`
outside passive `learn_new`).

**Sibling spacing**: a term's facets ("siblings") must not be adjacent. Each selected facet is
ranked within its term by priority (due-review > intraday-learning > unseen) via `ROW_NUMBER()
OVER (PARTITION BY user_lookup_id …)`; the outer queue orders by that rank first, so every
term's rank-1 facet precedes any rank-2. Best-effort: a term dominating the due set has no
separators left for its high-rank siblings, which go adjacent at the tail (accepted, not a
guarantee). For a term with only its citation facet the rank is always 1, so the order collapses
to plain due-time-then-new ordering.

Excluded everywhere: parked facets (`leech_parked_at IS NOT NULL`) and terms woven into the
currently-open reading text (`excludeUserLookupIds`).

**Over-cap learning**: the ONLY past-the-cap path is the composed queue's **Learn
extra** (§4b) — an explicit batch that PARKS extra recognition terms into warm-up with
`bypassCap` on the warm-up park guard (introductions still stamp `introduced_at`, so they
count toward today). Neither the rating path nor reading mode has a cap bypass.

## 4b. The composed queue (composePracticeQueue)

The primary **Practice** button serves ONE heterogeneous queue — gate exercises for
parked terms (warm-up + rehab) interleaved with due flashcards — built by
`composePracticeQueue` (`compose-practice-queue.ts`). Render type is **derived from term
state**, never chosen per item: parked → gate exercise; due/graduated → flashcard;
never-reviewed opt-in facet → flashcard. The filter spec
(`pools / scope / render / autoWarmup / includeOptInNew / learnExtraCount`, contract
`PracticeQueueFilterSchema`) only selects which populations participate; the Custom
practice presets are just named filter specs.

- **Parking pass (auto-warm-up).** With `autoWarmup` on (the default Practice), the
  compose first parks eligible never-reviewed citation terms into warm-up — discovery is
  by (user, language) via `listEligibleNewCitationFacets` (oldest-added first), the park
  writes reuse the session warm-up's mechanism (`runWarmupParkingPass` helpers in
  `warmup-parking.ts`). **Production parks first**, then recognition under the daily-new
  cap (first `cap_reached` stops the pass → `dailyLimitReached`). The budget is
  **coupled to serve slots**: at most
  `min(MAX_WARMUP_INTRO_PER_SESSION, MAX_GATES_PER_COMPOSE − uncredited parked backlog)`
  terms park per compose, so opening Practice never parks a term this session can't also
  serve (no invisible introduced-but-unseen backlog). There are therefore **no new
  citation flashcards** — new terms enter via ~3 gate-days, then graduate (soft
  re-entry).
- **Serve pass**, production-first (`prod flashcards → prod gates → recog flashcards →
  recog gates → opt-in-new` — pure concatenation of deterministic sub-lists, a stable
  one-shot snapshot). Due flashcards come from `listReviewTerms` pinned so **citation-new
  contributes 0 flashcard rows** (`review_due` scope for the due pass; `maxNewTerms = 0`
  on the opt-in pass). Gates come from `getStrengthenExercises` over a pre-sliced id set:
  `listParkedTerms(excludeCreditedToday: true)` — a term whose rehab day-credit was
  already earned today is **excluded** (answering it would consume a banked exercise
  while advancing nothing) — oldest-parked first, capped at `MAX_GATES_PER_COMPOSE`
  (which also bounds `ensureExerciseBank` fan-out per call). **Both parked origins serve
  together**: an onboarding gate is committed due work exactly like a rehab gate, so a
  daily Practice habit graduates warm-up terms as a side effect (no stranded lane).
- **Scopes.** `due_only` skips parking and opt-in-new (no introductions of any kind) but
  serves gates of both origins; `new_only` skips due flashcards and restricts gates to
  onboarding-parked terms.
- **Opt-in-new pass** (`includeOptInNew`, the Learn-new preset): never-reviewed
  pronunciation/form facets served as flashcards — they never park (the exercise bank
  has no facet identity), so this is their ONLY introduction path, reserved for the
  explicit Learn-new entry like the old learn_new-scope rule.
- **Learn extra** (`learnExtraCount`, 1–20): an explicit batch past the daily-new cap —
  `initializeAndParkCitationFacetIfUnderDailyCap` takes `bypassCap` (skips only the count
  predicate; `introduced_at` still stamps, so extras count toward today). Offered as a
  one-tap on the composed completion screen when the cap was hit; carried as mutation
  input, never a URL param, so refresh/back can't replay the bypass.
- **Hint pre-warm.** The compose mutation also fire-and-forgets hint-exercise generation
  for served flashcard terms whose bank has no hint-type slot (see §7 "Flashcard hints"),
  so the Hint button is usually live by the time its card comes up.
- **Refresh** (`refreshPracticeQueue`) is serve-only — the handler forces
  `autoWarmup: false`, drops `learnExtraCount`, and never warms hint banks — safe to
  poll; the client uses it only to swap `generating` exercise placeholders to
  `ready`/`failed` in place (keyed `(pool, userLookupId)`), never to append.

The old standalone flashcard queue (`mode=flashcards` on `/practice/review`, the
learn-new batch sheet, and the language-wide `warmup-continue` resume) is gone; reading
mode keeps `/practice/review` to itself. The post-session Strengthen CTA remains a
dedicated surface. The session-scoped warm-up (`/practice/warmup/$lang`) still exists
but has no UI entry point — the session-vocabulary footer now launches the zero-SRS
session recap quiz instead (client-side, no FSRS writes; see docs/REVIEW-SPEC.md), leaving the
composed queue's auto-warm-up as the sole warm-up on-ramp.

## 5. Rating flow (applyTermRating)

Shared by flashcards (`rateTerm`) and reading advances (`advanceReadingText`). Per rating:

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
   implicit reading 'good'), `was_introduction`, `caused_parking`, `practice_text_id`, and a
   `reverted_at` tombstone column — the foundation for undo and the review-budget count.
   Append-only; every event row represents an applied write.

Both `rateTerm` and `undoRating` validate the **legal `(pool, skill)` pairing** first (passive
↔ {recognition, pronunciation}; active ↔ production) — a crafted mismatch is a 400.
4. **Post-commit, fire-and-forget**: `parkLeech` (if the rating crossed the leech threshold)
   and `warmExerciseBank` (on parked / `again` / `hard` — pre-generates Strengthen
   exercises). A crash window can leave `caused_parking=true` without the park applied
   (accepted; un-parking an unparked term is a no-op — and undo's restore also clears it).

`rateTerm` resolves the per-language new-cap itself after loading the lookup row (the row
carries `target_language`); the active pool skips the fetch (no daily cap).

### Undo (undoRating)

`rateTerm` returns the logged event's id as `eventId` — **null exactly when nothing was
applied** (daily-cap refusal, or the parked stale-queue no-op; this disambiguates the two
`parked: true` response shapes — a rating that newly parked a leech carries an eventId and
is fully undoable). `practice.undoRating` takes that handle and, in one transaction:

1. Locks the **latest live** (`reverted_at IS NULL`) event for the **facet**
   (user, lookup, skill, target_form) — `FOR UPDATE` serializes concurrent undos. Keyed on
   facet identity, **not pool**: the passive queue can serve multiple facets per term, so pool
   would address the wrong card. If the passed eventId isn't that event (a later rating landed
   from another tab / reading mode, or it's already reverted), the undo is a stale-safe no-op:
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

## 6. Reading mode

Reading is **sessionless** (the `practice_sessions` table was dropped): state lives on
`practice_texts` directly, keyed `(user_id, target_language, pool, ord)`, with a partial
unique index allowing at most one `status='reading'` text per (user, language, pool).
Opening `Read` (`/practice/review/$targetLanguage?pool=&scope=`) resumes that in-progress
text when one exists — the language card's per-pool resume chips read the same state via
`listCurrentReadings`. Background pre-generation is opportunistic and must never surface
user-facing errors.

### Scopes and pools

A text is scoped to one target language, one pool, and one scope. Pool `production` is the
old active drill — it serves only terms with an enabled `(meaning_production, '')` facet
and has **no daily new-term cap** (the cap is a recognition-only concept, intentionally not
inherited so production reading never eats the recognition new-term allowance). Scopes:
`review_due` (already-introduced due terms only), `learn_new` (unseen terms up to the
remaining per-day allowance), `mixed` (default; both). The scope is a **live filter
re-evaluated per text** (`listReviewTerms`), not a frozen snapshot, and an in-progress or
pre-generated text built under a different scope is discarded before resume — entering
e.g. `Learn new` never surfaces a leftover `mixed` text. (Accepted transitional
inconsistency: reading introduces new terms directly into FSRS via implicit ratings — a
second intro path beside the composed queue's exercise-first on-ramp; reading lives under
Custom practice.)

### Text generation

One short text on demand at a time (~80–120 words, B1–B2 surrounding grammar regardless of
chunk level). The `status` + `ord` columns implement slot-based pre-generation:
`prepareNextReadingText` reserves the next slot and runs the LLM in a detached promise
behind a `generation_token` fence (raced or stale writers silently no-op), and the next
advance promotes the ready slot instead of generating synchronously.

The generation prompt is the methodology preamble + language instructions + user profile +
the chunk list (`headword`, `sense`, `translation`, `definition`, `target_example`,
`native_example`). Tool-use output: `body` + `used_chunks: [{ headword, sense,
surface_form }]` + `skipped_chunks`. **No char offsets in the tool schema** — LLMs are
unreliable at character arithmetic; the server locates each `surface_form` in `body` and
computes offsets itself, claiming non-overlapping positions when a surface form repeats.

Candidates come from the same `listReviewTerms` set as flashcards (same scopes/budgets —
no learn-new bypass), filtered to **citation meaning facets** (a text must never embed a
pronunciation or specific-form facet, whose front isn't the lemma) and excluding terms in
the currently-reading text plus just-rated terms that may not have left the due window
yet. When that set is empty, `generateNextReadingText` returns `done: true` and the
reading view shows an "All caught up" view. Generation itself never introduces terms —
facets enter FSRS lazily at rate/advance time (§5) and count against the daily-new
allowance there.

### Reading UX

The body renders each annotation as a clickable yellow span (rated → muted gray;
soft-deleted → strikethrough). Tapping an annotated chunk opens a `RateSheet`
(`Again / Hard / Good / Easy`) on `ResponsiveOverlay`. Its 3-dots overflow has `Edit term`
(navigates to the focus view of the chunk's representative card with `?from=practice` so
chevron-back returns to the same text), `Switch to active vocabulary` / `Switch to
passive vocabulary` (label follows the term's derived `learningMode`; calls
`chunks.setFacetEnabled` with `skill=meaning_production`, `targetForm=''`; hidden when
the annotation has no canonical `user_lookups` row), and `Delete from vocabulary`
(soft-delete via `chunks.deleteChunk` + a Sonner toast with a `Restore` action backed by
`chunks.restoreChunk`). Tapping a soft-deleted annotation opens a slim Restore-only
variant of the RateSheet. The `Next text` button advances; **every annotation not
explicitly rated is auto-rated `good`** (`was_explicit = false`) so passive reading still
informs the SRS.

**Peek + save unannotated spans.** Tap-to-select on plain body text (not covered by an
annotation) opens a `LookupSheet` with a fast one-line gloss + optional POS / register
chips. A single click/tap selects one `Intl.Segmenter` word in the text's target
language; press-and-drag extends to a word range. Annotation taps stay reserved for the
`RateSheet`, and ranges that cross an annotation are rejected rather than snapped. The
gloss reuses the same Haiku-powered `fastGlossPass` as tap-to-select in the session view,
exposed as `practice.fastGloss` keyed to the text body (no highlight row needed, no
server-side cache). `Save to vocabulary` routes the selection into the `cards.createAdhoc`
adhoc flow (passing the text body as the LLM context, truncated to 2000 chars), then
navigates to the new card's focus view with `?from=practice`.

### Advance (advanceReadingText)

On **advance**:

- `claimFinalize` is a one-shot status transition (reading → done); only the winner applies
  ratings — double-clicks/retries are no-ops.
- Every woven annotation's term gets rated: explicit if the user rated it in the sheet,
  otherwise an **implicit `good`** (`was_explicit = false`). Annotations resolve to their
  term by the `user_lookup_id` stamped into the annotation at generation time (fallback:
  the `(headword, sense)` key, for texts stored before ids were stamped), so a mid-text
  `chunks.rename` never drops a rating.
- Skipped: terms already reviewed after the text was prepared
  (`wasReviewedAfterTextWasPrepared`), terms ineligible for the session's scope, deleted
  terms, and facets with `disabled_at` set — a facet disabled mid-text (production
  demotion, dormant term) keeps its history but must not be advanced, or introduced, by
  the implicit pass.

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
- **Parked** = out of every queue (flashcards and reading candidates — both feed from
  `listReviewTerms`, which filters on the parked column; this is intentional, since
  reading's implicit `good` on advance must never mutate a parked facet's FSRS). The
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
  auto-parks eligible new terms language-wide on every compose (§4b) — the sole UI
  on-ramp. The session-scoped `/practice/warmup/$targetLanguage` route +
  `startWarmupSession` (parks one session's terms explicitly) remain functional but
  unreferenced: the session-vocabulary footer now opens the zero-SRS session recap
  instead (see docs/REVIEW-SPEC.md). Abandoned warm-ups need no dedicated resume surface, since
  the next Practice serves the parked terms' gates anyway.
  `startWarmupSession` parks the session's not-yet-introduced kept terms in **two
  independent passes** (shared with the composer via `runWarmupParkingPass` helpers): a
  recognition pass via the **atomic** `initializeAndParkCitationFacetIfUnderDailyCap` (stamps
  `introduced_at` AND `leech_parked_at` in one tx, leaves `srs_state` NULL — so a crash can't
  leave a term introduced-but-unparked; returns `'scaffolded' | 'cap_reached' | 'not_eligible'`,
  the first cap hit stopping further **recognition** entries and flagging `dailyLimitReached`,
  `not_eligible` skipped; `bypassCap` is the composer's learn-extra path), and an
  independent production pass via
  `initializeAndParkProductionCitationFacet` (`'scaffolded' | 'not_eligible'`, uncapped) that
  **never inherits the recognition cap's stop**. The served queue is **mixed** (recognition ++
  production); each `StrengthenExerciseEntry` carries its `pool` so the client merges
  placeholders by `(pool, userLookupId)` (a both-skills term has one entry per pool with the
  same id) and its `origin` (`onboarding`/`leech`, derived from `srs_state`) so mixed-origin
  queues pick the right copy; `submitExerciseAnswer` routes to the right facet.
- The recognition warm-up consumes the **same daily new-term budget** as flashcards on entry,
  so over-cap terms wait for tomorrow; the production warm-up is **uncapped** (production is
  never daily-new-capped) and never flags `dailyLimitReached`.
  `initializeCitationFacetIfUnderDailyCap` also carries an `AND leech_parked_at IS NULL` guard
  so a parked warm-up facet is never re-introduced as a flashcard.
- **Serve-only refresh.** `refreshWarmupSession` (session, both pools) re-serves with no
  parking/introductions — safe to poll while exercises generate. Resume-safe: serving covers
  every onboarding-parked term (already-parked + newly-parked), so a re-enter after
  `generating` placeholders never returns empty.

### Exercise bank + serve resilience

- **Exercise bank** (`exercise-bank.ts`, `practice_exercise` table): durable
  pre-generated exercises per `(user_lookup, pool, exercise_type)` — passive
  `mc_cloze, mc_comprehension, use_in_sentence`; active `mc_cloze, production_cloze,
  use_in_sentence`. `use_in_sentence` generates for both pools but is **ungated bonus
  only** (`gate_eligible = false`) — an LLM grading error must never block a graduation.
  Strengthen serves one gate exercise per parked term (oldest first) plus bonus exercises
  for this session's again/hard set.
- **Lifecycle + consume-on-answer.** Slots mirror the `practice_texts` fencing lifecycle:
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
  independent-context adversarial VERIFY (Sonnet by default; the `EXERCISE_VERIFY_MODEL`
  env var flips it back to Opus in one line), up to `MAX_GEN_ATTEMPTS = 3` full cycles
  before the slot fails. The verifier substitutes each distractor into the blank and fails
  the exercise if any substitution is grammatically valid AND semantically defensible;
  distractors must match the answer's POS and inflection/agreement (so grammar alone can't
  eliminate them) while being semantically wrong in that sentence; production-cloze blanks
  must be inflection-unambiguous from the sentence's cues. Retries are informed, not
  blind: each cycle feeds the verifier's prior rejection reasons into the next generation
  prompt. Verifier verdicts are parsed leniently (a string `"true"` counts as pass) and a
  fail with zero reasons — a state the verify prompt forbids — is re-verified once before
  it counts, so a malformed tool call can't silently convert passes into rejections. Blank
  offsets are computed server-side by substring search over the emitted `surface_form`
  (never LLM char arithmetic); options are shuffled server-side. Generation prompts work
  from headword + sense (+ definition/translation when present) — no dependency on stored
  examples. `use_in_sentence` payloads are built deterministically (no LLM at generation
  time).
- **Grading is server-side only.** Served payloads are stripped of `answer` /
  `answerIndex` / `acceptedForms`; the truth (`correctIndex` / `correctAnswer`) is
  revealed only in the answer response, after the exercise is consumed. MC = index
  equality. Production cloze: NFD-normalize + strip diacritics + lowercase + trim, then
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
  The compose mutation pre-warms gaps: `warmHintExerciseBanksForFlashcards` checks the
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
refresh) and `/practice/warmup/$targetLanguage` (session-scoped warm-up; search
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
(non-consuming — it re-serves next session, so "I don't know" on a gate doesn't burn the
fresh exercise or the day; to *see* the answer, submit a guess — that consumes and
reveals). Cloze exercises (`mc_cloze` + `production_cloze`) also offer an opt-in **Hint**
button beside Skip (same lightbulb treatment as the flashcard hint): pressing it reveals
the term's meaning under the sentence — the entry's `translation`/`definition` resolved by
the same rules as flashcard faces (definition-only when L1 = L2 or Show translations is
off; production cloze falls back to its generation-time `payload.hint`). The hint is
free — it never affects gate credit — and is never auto-expanded; `mc_comprehension` gets
no hint, since its options are meaning paraphrases. Cloze blanks render as literal
underscores. MC answers highlight the correct option from the response's `correctIndex`;
production cloze reveals `correctAnswer` on a miss; use-in-sentence is labelled **Bonus**
and shows the LLM feedback. Every answered exercise appends a `Meaning: …` reminder line.
Gate answers render a "Day N of 3" rehab progress note from the response's
`rehabCorrectDays`, and `graduated: true` renders a graduation celebration ("back in your
practice rotation"); the dueSummary invalidation drops the parked counts.

## 8. Frontend session model (composed-practice-view.tsx)

- The queue is a **one-shot client-side slice of union items**
  (`{type:'flashcard'} | {type:'exercise'}`): seeded from the compose mutation's
  response, re-entered fresh on every mount (the route keys the view on the serialized
  filter). The serve-only refresh poll (~4s while a `generating` exercise placeholder is
  at/ahead of the index) only upgrades placeholders in place
  (`mergeComposedPlaceholders`, keyed `(pool, userLookupId)`) — it never appends, so a
  term graduating mid-session becomes a flashcard on the NEXT session, not this one.
  Navigation still drops the in-session state (rating records, Strengthen set, position).
- **Exercise items** render through the shared exercise components
  (`McExercise` / `ProductionClozeExercise` / `UseInSentenceExercise`) with per-entry
  copy from `origin` (warm-up vs rehab); skips are non-consuming as in Strengthen.
  Each `StrengthenExerciseEntry` carries the term's `translation`/`definition`
  (straight off `user_lookups`), resolved client-side by `useTermMeaning` under the
  flashcard-face rules (definition-only when L1 = L2 or Show translations is off).
  That meaning powers an opt-in **Hint** button on the cloze types (`mc_cloze` +
  `production_cloze`; free — no effect on gate credit; `mc_comprehension` is excluded
  since its options ARE meaning paraphrases) and a post-answer `Meaning: …` reminder
  on every type. Post-answer feedback (verdict / expected answer / meaning / rehab
  progress) renders in `ExerciseLayout`'s pinned feedback slot above the status row —
  always visible, height-capped — instead of the scrollable body.
  Flashcard items render `FlashcardFace` (the extracted presentational card body) +
  `RateButtons`.
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
- **Again-redrill**: rating `again` optimistically appends a copy of the card to the local
  queue in the same render as the index advance (so the Learning pill never dips); the copy
  is rolled back by object identity if the server says cap-rejected / parked / error, guarded
  by `indexRef` so an already-consumed copy is never removed.
- `sessionHardRef` collects this session's again/hard terms → offered to Strengthen
  afterwards.
- **Peek + re-rate**: the back-chevron (`peekBack`) shows previous items. A peeked
  **flashcard** whose rating durably applied (rating record keyed by queue-item identity,
  holding the response's `eventId` + its redrill copy) re-shows the rating buttons with the
  previous rating highlighted — unless its redrill copy was itself already rated (the
  original's event is no longer latest; the server would refuse, so no dead buttons).
  Re-rate runs undo → fresh rate (§5), then reconciles: old `again` → new `good`+ removes
  the unconsumed redrill copy; old `good`+ → new `again` appends one; `sessionHardRef`
  updates by lookupId. Any outcome that leaves the card unrated server-side (stale undo,
  cap refusal on the fresh rate, error after a committed undo) drops the record and
  re-appends a fresh queue item so the card resurfaces rateable. A peeked **exercise**
  is read-only (its answered/skipped outcome) — a consumed exercise can't be
  un-answered.
- **Edit during practice**: a header kebab opens an actions menu (`TermActionsOverlay`) for
  the term behind the displayed item — flashcard or exercise alike (an exercise entry
  carries its own `userLookupId`/`pool`); `Edit term` deep-links to the focus view via
  `chunks.get`'s representative-card pointer (`firstCardId`/`firstCardSessionId`, fetched
  lazily on menu open) with `from=practice&practiceMode=flashcards`, so the focus view's
  close returns to a fresh everyday composed queue (`practiceMode=read` returns to the
  reading route). The dedicated Strengthen/Warm-up sessions (`ExerciseSessionView`) carry
  the same kebab, passing `practiceMode: 'strengthen' | 'warmup'` + their route's re-entry
  state (`practiceSessionHard` / `practiceStudySessionId`) so close re-enters the same
  session (serving is read-only + consume-on-answer, so it re-serves the remaining work).
  The kebab is **withheld while it could spoil an answer**: an unanswered cloze exercise
  (the headword IS the cloze answer) or a live `generating` placeholder, which can swap in
  place to a cloze on the next poll — the generating placeholder's body copy and exercise
  header are headword-less for the same reason (terminally `failed` placeholders and peeked
  never-swapped items still name the term).
- **Status row**: the sticky bottom control area is ONE row shared by every item type —
  flashcards, exercises, hint mode, and peeked items alike: peek chevrons framing colored
  remaining-count chips (derived from the remaining local queue, `getRemainingCounts`).
  Chips bucket by **learning stage, not render type** — `new` (never-reviewed flashcards +
  warm-up gates: a warm-up gate IS the term's first encounter), `learning`
  (learning/relearning flashcards + `Again`-redrills + rehab gates), `review` — so a fresh
  user who just added terms sees "7 New", not "7 Exercises" beside three zeros. Each chip
  is a press target opening a short explanation popover (click/tap only, never hover — the
  chips sit next to the answer buttons, where hover-open would misfire constantly); below
  the `sm` breakpoint the chip labels collapse to screen-reader-only (dot + count) so the
  row fits phone widths. The back chevron is withheld while a live exercise or hint is
  displayed (peeking away would unmount it, and an already-consumed exercise can't be
  re-answered on remount).
- Landing/status lines compute servable work client-side from the due summary + per-language
  limits (`getPracticeLimitsForLanguage`): `servableReviewDue = min(reviewDueCount,
  reviewBudgetLeft)`; precedence when nothing is servable: "Daily review limit reached." >
  "Daily new limit reached." > "No terms are ready right now.".

### Landing + language action screen

`/practice` is a per-language selector. Each row shows the full language name plus a
compact status summary (follow-up timing / unseen / total) and opens
`/practice/language/$targetLanguage`. When the language has any active-pool terms the
summary appends `· N active`; when any terms are warming up it appends `· N warming up`
(recognition + production onboarding combined, `warmupCount + productionWarmupCount`);
when any terms are leech-parked it appends `· N parked` (both pools' leeches — warm-up
terms are counted separately under "warming up").

`/practice/language/$targetLanguage` is ONE card — the system makes the strategic
decision, not the user. A single primary **Practice** button enters the composed queue
(`/practice/composed/$targetLanguage`). A secondary **Custom practice** button opens an
overlay with the focused presets (`Review (due, no new)`, `Flashcards only`, `Learn new`,
`Exercises only`, `Production focus` — each just a composed-queue filter spec), the `Read`
reading mode, per-pool reading history, and a build-your-own filter panel (pools / scope /
item types / opt-in-new toggle, with inline reasons on contradictory combos — e.g.
new-only + flashcards-only without opt-in cards is empty by construction). A one-line
status summary folds both pools (`N to review · N new today · N warming up ·
N to strengthen`), absorbing the old standalone "warming up — continue" and "parked —
strengthen" banners; in-progress reading texts keep their per-pool resume chips on the
card. The stat cards (Follow-ups / New today / Unseen / Total) render below.

The **due summary** endpoint returns per language: `newCount` (unseen), `reviewDueCount`,
`learningDueCount`, `nextLearningDueAt`, `newIntroducedTodayCount`, `reviewedTodayCount`
(off the event log), `parkedCount`, `warmupCount`, and the `production*` mirrors
(`productionParkedCount`, `productionWarmupCount`, …). The parked population is split by
origin **on both pools**: `parkedCount` / `productionParkedCount` are leech-only (parked +
`srs_state IS NOT NULL`), `warmupCount` / `productionWarmupCount` are onboarding (parked +
`srs_state IS NULL`); the landing folds them into the status line (warming-up and
strengthen counts), and the composed queue serves both origins' gates in one session.
`newCount` / `productionNewCount` exclude parked rows so a warm-up term is never advertised
as servable-new.

### Flashcard faces

Card face composition is declarative in
`packages/core/src/constants/card-face-config.ts`. `DEFAULT_CARD_FACE_CONFIG` shows
`headword` + `targetExample` on the front and `translation` / `definition` /
`nativeExample` / `grammar` on the back; `ru` and `en` (the Kaikki-grounded languages with
Wiktionary IPA today) defer `ipa` to the back on recognition cards, since pronunciation is
part of the answer. The resolver filters abstract slots by runtime conditions:
translations/native examples hide when L1 = L2 or Show translations is off, definition
shows in that hidden-translation mode and also falls back when translations are enabled
but no translation exists, IPA shows only when `pickIpa` returns a displayable bucket, and
grammar shows only when chips can render. Headwords use `grammar.display_form || headword`
so Russian stress-marked forms carry through.

### Keyboard shortcuts (desktop)

Every practice surface — the composed queue, the dedicated Strengthen/Warm-up sessions,
and the session recap — is fully keyboard-drivable through one shared data-driven hook
(`apps/web/src/hooks/use-hotkeys.ts`: a global keydown listener per view with per-binding
enabled gates; a matched key always `preventDefault`s, which both stops Space-scroll and
suppresses native re-activation of a still-focused button). Bindings: flashcard front
`Space`/`Enter` = Show answer, `H` = Hint (when banked); flashcard back `1`–`4` =
Again/Hard/Good/Easy with `Space`/`Enter` = Good (Anki muscle memory; digits match by
**physical key position** — `event.code Digit/Numpad` — so bare top-row presses work on
AZERTY); hint outcome `Enter`/`Space` = Continue; MC exercises `1`–`4` pick an option, `H`
reveals the meaning hint, `S`/`Esc` skip; typed exercises autofocus their input on
desktop, whose own `Enter` submits (use-in-sentence is chat-style: `Enter` submits,
`Shift+Enter` newline) — the only globals that fire while typing are `Esc` = skip and the
post-answer `Enter`/`Space` = Next; still-generating placeholders `S`/`Esc`/`Enter`/
`Space` = skip; failed decision cards `Enter`/`Space` = Study as flashcard, `S`/`Esc` =
skip; peek mode `←`/`→` drive the chevrons (same withhold rules), `1`–`4` re-rate when
offered, `Enter` returns to the current card; completion screens `Enter` = the primary
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
