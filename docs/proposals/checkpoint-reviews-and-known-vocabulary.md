# Checkpoint reviews, known vocabulary, and personalized difficulty

> **Status: proposal — rollout phases 1 and 2 implemented.** Design for making
> authentic content (sessions) feed the SRS and the coverage picture: explicit
> checkpoint-based recognition reviews while reading/watching, known-vocabulary
> marking (including never-practiced backlog terms), and a personalized
> text-difficulty stat. Companion to
> `docs/proposals/vocab-coverage-visualization.md` — shares its lemma/frequency
> assets and resolves several of its open questions (deltas recorded below).
> Designed 2026-07-16/17. Phase 1 (checkpoint reviews + the backlog
> known-assertion action) and phase 2 (`lemma_ranks` build + the difficulty
> stat) are implemented — behavior specs in `docs/SRS.md` /
> `docs/READER-SPEC.md` / `docs/DATA-MODEL.md` are the source of truth.
> Phase 2 deltas vs this design: a minimal `known_lemmas` slice was pulled
> forward from phase 3 (per-session mark-the-rest-known sweep + gloss-sheet
> un-mark chip — without it P=0 for every unsaved word and the headline read
> absurdly low); the track profile stores token-level candidate GROUPS with a
> query-time max(P) ambiguity rule so coverage conserves mass; the difficulty
> surfaces are session cards + the session header (the source-wizard surface
> was skipped); surface-exact form-facet crediting stays deferred (open
> question below). Phase 3 (the grid, claimed/verified split, bulk un-mark by
> source) remains an unimplemented proposal.

## Problem / motivation

Reading mode's generated texts were built to practice terms naturally in
context, but forcing specific terms into an LLM-written text — even with
freedom to pick from a set — produces stilted prose. Authentic content (the
user's own sessions: videos, subtitles, texts, lessons) is the natural home
for in-context review.

The product thesis: **flashcards should end up holding only the terms that are
truly hard to remember or rare.** Reading and watching are the enjoyable
activities; spaced repetition works but is a chore. If passing a term in real
content can count as a recognition review, then:

- Frequent vocabulary clears through reading — it recurs constantly in
  whatever the user consumes, so its due reviews get absorbed by content
  almost automatically. (Users can't judge frequency when saving; without
  this, common words balloon the queue.)
- The flashcard queue specializes in the long tail: rare words don't recur in
  content, so they surface as flashcards — correctly, since rare vocabulary is
  exactly what reading won't reliably refresh.
- The visible "N reviews collected" progress while reading is honest
  gamification: motivation to finish the text/video.

Accuracy posture matches the coverage proposal: this is a motivating
instrument, not a linguistic measurement. Small systematic errors are
acceptable; everything is undoable.

## Feature 1 — checkpoint reviews

The SRS already has an "implicit rating behind an explicit action" contract:
reading mode auto-rates unrated annotations `good` (`was_explicit = false`)
when the user explicitly advances (`docs/SRS.md` §6), and lesson import
applies implicit budget-exempt `again` lapses at confirm. Checkpoint reviews
extend that contract to real sessions.

### Contract

**Nothing is ever credited automatically.** The user presses an explicit
checkpoint affordance — "collect reviews up to here" — and only saved terms
appearing in the span since the last checkpoint are credited. Skimming a text
to find a section, or watching a video without engaging, changes nothing.

### Mechanics

- New monotonic `study_sessions.reviewed_until_segment_index`, parallel to the
  existing `furthest_read_segment_index` (which stays a pure scroll tracker).
  Each press credits only the span `(last checkpoint, new point]`, so repeated
  presses never double-credit.
- Resolution: tokenize the span's segments, fold each token, join distinct
  tokens against `wiktionary_forms` → `wiktionary_entries.headword`, intersect
  with the user's `user_lookups` (see the matching layer below).
- Credit = implicit `good`, `was_explicit = false`, applied only to facets in
  `srs_state IN ('new','review')` that are due, enabled, `ready`, and not
  parked — the same predicate as the review-budget count.
  Learning/relearning, parked, and disabled facets are excluded (below). A
  new provenance column `practice_rating_events.study_session_id` (same
  pattern as `practice_text_id` / `import_batch_id`) records the origin.
- Checkpoint credits **count toward the daily review budget** — they are
  completed review work, and counting them is the mechanism by which
  authentic reading replaces that day's flashcard load (the served queue
  shrinks by exactly the reviews already done). The budget can never *block*
  a checkpoint: only the queue is budget-gated; the rating path has no
  review-cap refusal. (Contrast lesson-import lapses, which stay
  budget-exempt: those are `again`s that *create* work.)
- Facet scope: `(meaning_recognition, '')` in v1. Optional later bonus: an
  exact surface-form match may credit a matching form facet (no lemmatization
  needed). Pronunciation facets are never credited by silent reading.
- A word the user glossed or highlighted inside the span has its credit
  **suppressed — never converted to an inferred `hard`/`again`**. A lookup
  can mean checking nuance rather than forgetting, and the gloss sheet's
  whole design is "looking is free": punishing looks would teach users not to
  look. Preview glosses count as suppression signals too (the sheet cannot
  distinguish curiosity from ignorance, so it doesn't try).
- A checkpoint pass over a saved term also refreshes
  `user_lookups.last_encountered_at` (a mode of `recordEncounter` that does
  NOT bump `encounter_count` — tier-1 "revealed demand" stays reserved for
  deliberate re-saves), so the 90-day new-term decay never shelves a term the
  user just read. Cheap aggregate evidence persists for future features —
  `content_encounter_count` / `last_content_encounter_at` per lookup — but no
  per-occurrence event log (unbounded, and nothing needs that granularity).
- Undo: the press is a discrete event, so a toast reverts exactly that batch
  (provenance column + `rated_at` range) through the existing `reverted_at`
  tombstone machinery; budgets refund themselves. Because undo happens seconds
  after the credit, the "only the latest live event per facet may restore its
  snapshot" invariant is effectively never violated.

### Why review-state due facets only

- Early contextual exposure is genuine reinforcement, but it cannot reliably
  be translated into an FSRS grade — context primes the meaning, so passing a
  non-due card in text is weaker evidence than the isolated recall its
  schedule models. Rating it anyway inflates intervals. (Non-due exposure is
  still recorded as encounter aggregates, above — just never as a rating.)
- Due-only self-limits repeat crediting: after one credit the card isn't due
  for days, so the next session skips it.
- It caps the blast radius of a wrong-sense credit to one bogus `good` on a
  due card, which the next failed review and the leech machinery self-correct.
- **Remediation states are excluded**, not just non-due ones:
  - *Parked (leech or onboarding)*: reading mode already establishes the
    principle — an implicit good "must never mutate a parked facet's FSRS"
    (`docs/SRS.md` §7). A leech is a term the user demonstrably keeps
    failing; weak contextual evidence must not override the rehab loop.
  - *Learning/relearning*: a mid-ladder card is usually one the user just
    failed; an implicit good could graduate it out of remediation on the
    weakest possible evidence. Flashcards finish the ladder.
  - *Disabled / not `ready`*: consistent with every other serving path.

### Which lane applies to which facet state

The implicit credit (this section) and the backlog known-assertion (Feature 2)
are different operations and never overlap. The principle: **the strength of
the evidence must match the strength of the write.** Implicit exposure is weak
evidence — enough to *confirm* a prediction the SRS already made (the card was
due; the user read past it without glossing), never enough to *create* SRS
state from nothing. Creating state requires an explicit user assertion.

| Facet state at checkpoint | What happens |
|---|---|
| Review-state (`new`/`review`), due | Implicit `good` from the press itself |
| Review-state, not due | Nothing — exposure is real but not gradable; only encounter aggregates persist |
| Learning/relearning, parked, disabled, or not `ready` | Nothing — remediation and disabled states are never touched by implicit evidence |
| Never introduced (`srs_state IS NULL`), unparked | Nothing implicit; offered only in the opt-in sheet as a known-assertion (an *introduction*, not a review — see Feature 2) |
| Onboarding-parked | Nothing implicit; the opt-in known-assertion *exits onboarding* instead (see Feature 2) |

This is also why the two lanes carry different risk treatments: implicit
credits are frictionless with an undo toast; claims sit behind a deliberate
tap.

### Positional spans over multi-day reading

The span is a range of *text*, not a set of terms, and FSRS owns the cadence
— so long texts read across many days need no special handling:

- A term from an earlier span that reappears later is simply in the new span;
  whether it credits is decided solely by its current facet state (due →
  credit; parked / not due → nothing).
- A word occurring 10× in a text earns at most one credit per due-cycle:
  within one span it dedupes to one candidate, and after a credit it isn't
  due again for days-to-weeks. Appearance frequency cannot pump the schedule.
- Reading and Practice interleave freely — both are rating paths into the
  same facets, and checkpoint credits shrinking that day's served flashcards
  is the replacement effect working as intended.
- Re-reading earlier sections produces no new span (the pointer is
  monotonic), so no double credit. Accepted edge: a term that comes due
  *after* its last occurrence in the text can't be credited from that text
  again — flashcards catch it.

### UI placement

- **Web reader:** a button in the existing sticky footer (next to
  `Session vocabulary`). **The label is the comprehension assertion, not the
  reward**: an assertion verb ("I've followed up to here") with the pending
  count as a passive badge, and "12 reviews collected" as the *result* toast
  — a reward-labeled button invites pressing without the assertion being
  true, while the badge keeps the read-to-the-end motivation visible.
  Hidden/disabled at zero. Anchored to the **furthest-read pointer, not the
  viewport** — it means "everything I've read so far" even after scrolling
  back up, and the tracker already exists.
- **End of content:** a stronger close-out card when the reader reaches the
  end — the common case is finishing the text/episode; this is also where the
  opt-in claims (below) get their fuller presentation.
- **Extension (video):** on the controls overlay, anchored to current
  playback time mapped to a segment index. Same primitive, same backend call.
  The evidence is the **explicit press, not playback position** — pressing on
  the video overlay asserts comprehension exactly as in the reader, so this
  is not an evidentiary downgrade; forcing a platform→web round-trip would
  break the loop the feature closes. Mitigation kept: the affordance lives on
  the pause-state controls, so the press happens while paused — a deliberate
  act. The web reader still ships first, as sequencing (cheapest place to
  validate the mechanics), not as principle.
- **Two lanes by risk:** the press credits reviews immediately (toast + undo)
  — low-risk, revertible, frictionless. The *claims* (mark-known sweep,
  backlog assertions) sit behind one optional sheet after collecting, never on
  the primary press.
- The checkpoint (FSRS-real, lives in the reader) stays cleanly separate from
  the session-recap quiz (zero-FSRS, lives on the session-vocabulary list).

## Feature 2 — known vocabulary

The `known_lemmas` table is as specced in the coverage proposal: a stateless
assertion — `(user, target_language, lemma, source)`, no facets, no FSRS
state, no history. That statelessness is what makes every correction path a
trivial write. Decisions fixed here:

### Correction paths ("I marked it known but I don't know it")

- **Realized they don't know it →** gloss + save, like any unknown word. The
  term enters the SRS as brand-new (correct — the known mark never touched
  FSRS). The stale `known_lemmas` row is resolved by **read-time precedence
  (studied > known), never delete-on-save**: the lemma key is sense-blind, so
  marking *bank* (river) known stays true when the financial sense is later
  saved as its own `(headword, sense)` lookup. Only divergence: soft-deleting
  the studied term falls back to "known" — accepted noise.
- **Doesn't know it, doesn't want to study it →** the gloss sheet shows a
  "Marked as known" chip with a remove action (a bare `DELETE`, zero side
  effects). Bulk: "un-mark everything from this checkpoint" via the
  `source_id` the coverage proposal already anticipated.

### Ghost nominations never read `known_lemmas`

Tempting (don't suggest words the user claims to know), but a careless bulk
mark would silently suppress nominations for words the user actually
struggles with — and unlike a coverage miscount, the user can't see what
they're *not* shown. Coverage errors are visible and cheap; suppressed
suggestions are invisible. Manual glossing works regardless, so nothing is
ever blocked.

### Backlog terms ("I already know this")

The case: a saved term with a `(meaning_recognition, '')` facet that has never
been introduced (`srs_state IS NULL`, never seen in Practice). Such facets are
never touched by the checkpoint press itself — they have no schedule to
confirm; this explicit assertion is their only entry here (see "Which lane
applies to which facet state" in Feature 1). Asserting knowledge should skip
the warm-up on-ramp — gates are *teaching* scaffolds, pointless for a known
word.

- **Semantics: a first rating through the existing `rateTerm` path**, seeded
  as review state — but with a **generous seed** (stability weeks out, not the
  ~4-day `easy` graduation). Assertion isn't demonstration, but the asymmetry
  favors trusting the user: a wrong claim costs one failed verification
  (relearning → leech machinery walks it back), while a short seed costs
  guaranteed near-term reviews on every *correctly*-known term. Load math: a
  correctly-known word at recognition's 0.8 retention costs ~3–4 reviews in
  its first year, decaying after; flipping 30 backlog terms adds well under
  one review/day, spread by FSRS fuzz.
- **Never touches the daily-new budget, in either direction.** A known
  assertion creates no immediate learning work, so it must neither be refused
  over the cap *nor consume the count*: naively stamping `introduced_at`
  (Learn-extra style) would starve same-day learning, since the new-budget
  guards count citation facets with `introduced_at` = today. Resolution:
  known assertions do NOT stamp `introduced_at` at all — mirroring
  `initializeFacet`'s existing convention for non-daily-capped introductions;
  the rating event is the historical record. Verifications land in future
  days' review budget (default 100/day). The event logs
  `was_introduction = true`, so `undoRating` restores `srs_state` to NULL and
  refunds correctly.
- **Recognition only.** Recognizing ≠ producing; an unseen production facet
  keeps its own on-ramp.
- **One user-facing action, two write paths.** "I know this" collapses the
  ramp identically for unseen, decayed (90-day shelf), and onboarding-parked
  facets — but the writes differ. Unseen/decayed = an introduction. An
  onboarding-parked facet (already `introduced_at`-stamped,
  `leech_parked_at` set) instead gets an **unpark + generous-seed write** —
  it *exits onboarding* rather than being introduced again (cf.
  `unparkTermToFlashcard`, which already does unpark + review-state entry
  for terminal exercise failure). Undo must restore the *exact* prior state:
  the existing event machinery can un-park on revert (`caused_parking`) but
  nothing can re-park — the parked case needs a small event extension (e.g.
  `caused_unparking`) so reverting re-parks.
- **Grouped opt-in, never automatic.** The mark-all-known sweep still skips
  saved terms — saving is a stronger, more specific signal than a blanket
  "everything else is known," and silently flipping dozens of backlog terms
  from one press erodes trust. Instead the checkpoint sheet *surfaces* the
  overlap: "4 words in this text are in your vocabulary but never practiced —
  mark those known too?", list behind a disclosure when large. One extra tap
  for the whole group (vs LingQ's per-word status grinding; the app's default
  direction is already inverted — highlighting means "I don't know this").
  The list **excludes terms saved within the current session** (the user just
  deliberately chose to study them — offering to known-away a
  five-minute-old save is contradictory) and, consistent with the
  suppression rule, terms glossed or highlighted inside the credited span.

### Claimed vs verified

Known-asserted lemmas and backlog assertions count as **"claimed"** in the
coverage stat until their first successful explicit *or checkpoint* review
flips them to **"verified"**. This resolves the coverage proposal's
trust-the-bulk-marks open question with no added review load — a checkpoint
credit is itself the verification event. Verification is guaranteed to be
*later, independent* evidence for free: the generous seed puts the facet's
due date weeks out, and due-only crediting makes a same-session (or
same-week) checkpoint structurally unable to verify its own claim.
Known-only lemmas (no `user_lookups` row) simply **stay "claimed" forever**
— "verified" means "has successful review history," and the upgrade path is
saving the word; bolting verification machinery onto the stateless
`known_lemmas` table would reintroduce exactly the scheduling state it
exists to avoid. With generous seeding + reading absorption, measured
retention for asserted terms stays untested for a while; the split keeps the
headline number honest about that.

## Feature 3 — personalized difficulty

**Expected coverage = Σ over the text's token mass of P(known)**, where
P = 1 for marked-known lemmas, **FSRS retrievability** (computable from
stability + elapsed time) for studied ones, 0 for unknown. One principled
number that naturally encodes "an advanced learner knows most of this text's
rare words" — no ad-hoc tweak factor.

- Present as "you'll understand ~93% of this" plus "42 unknown words, 15 of
  them frequent" — actionable, not a bare scalar. The headline is **one
  blended number** (claimed + retrievability-weighted studied), with the
  verified share as a quiet secondary line / detail view — an
  "X% verified, up to Y% including claimed" range headline is
  instrument-panel language; a slight overclaim in the headline with honesty
  one glance away beats two confusing numbers. Blending also absorbs the
  nuance that an unverified claim and a fragile studied term are both
  partial confidence.
- Labels from the extensive-reading thresholds: ≥98% comfortable, 95–98%
  challenging, below frustrating.
- Scope honestly: this is *vocabulary* coverage; syntax, speech rate, and
  abstractness are excluded. Don't present it as total difficulty.
- Requires `lemma_ranks` (frequency mass), so it ships after the offline
  build; the checkpoint feature does not depend on it.

## The matching layer (shared by all three)

**Reuse the loaded Wiktionary tables instead of building the coverage
proposal's separate `form_to_lemma` table.** `wiktionary_forms
(target_language, form, entry_id)` already is a form→lemma mapping, indexed
on `(target_language, form)` and loaded in prod at full scale (ru 441k
entries / 1.46M forms, de 367k / 1.49M, en 1.47M / 908k).

- **Folded expression index** over `wiktionary_forms.form` applying the spike
  rules (lowercase, strip U+0301, ё→е, ß→ss per language); incoming tokens
  fold identically at query time. The SQL fold expression must be pinned
  byte-for-byte against the offline rank-build script — same discipline as
  `normalizeTargetForm` (`packages/core/utils/normalize-target-form.ts`).
  ~50–70 MB of index per language vs ~110–130 MB per language for a separate
  table, and no second copy of the mapping to keep in sync.
- **2-hop stub folding** (de `dies` → alt-of → `dieses` → form-of → `dieser`):
  a small precomputed redirects table (thousands of rows) or a recursive
  lookup.
- **Headword fold:** `user_lookups.headword` is LLM-normalized and not
  guaranteed to equal the kaikki lemma (`to run`, `sich freuen`) — a small
  per-language headword→lemma fold, applied on the (small) vocab side.
- **Hard language gate:** supported only where dumps are loaded (ru/de/en
  today; more major languages planned). Unsupported languages get **no
  degraded fallback** — the feature is simply absent, same tier posture as
  grounding. The removed FTS exclusion-prefilter machinery
  (`docs/EXCLUSION_PREFILTER.md`, historical) stays dead.

### Sense disambiguation — only where it can actually go wrong

Most matches need no check: the genuinely dangerous case is when the *user's
own vocabulary* holds 2+ senses of one headword, and those are enumerable for
free from the `(headword, sense)` unique key.

- Headword with one saved sense → credit on form match, no LLM. (The text
  might use a sense the user never saved — then they either know the word
  anyway or they gloss it, which suppresses the credit.)
- Headword with 2+ saved senses → batch those occurrences, with their segment
  as context, through a Haiku pass that picks the sense — the shape of the
  removed `sense-disambiguation-pass`. Small fraction of matches; near-zero
  cost per checkpoint.

### Multi-word expressions — recall filter + LLM confirm

MWEs (headwords with spaces) can't be resolved by single-token lookup, and
contiguous n-gram matching structurally misses separable verbs, free word
order, and interruptions ("ran *straight* out of"). Two stages instead:

1. **Cheap recall filter:** all content lemmas of the MWE present within one
   segment (lemma-set check via the same fold, or tsvector containment).
   Liberal by design, like the old prefilter.
2. **Haiku confirm:** the candidate MWE + the segment; the model judges
   whether the expression actually occurs (inflected/reordered counts, shared
   words in unrelated roles don't). MWE candidate volume is small, so this is
   where the LLM check earns its cost — single words mostly avoid it.

## Frequency-asset lifecycle (updating / replacing the data)

User data never references the frequency asset by anything except lemma text
(`known_lemmas.lemma`, `user_lookups.headword`; rating events store
headword/sense verbatim), so revising or replacing `lemma_ranks` is
TRUNCATE + reload per language:

- Checkpoint reviews are untouched — the matcher rides on
  `wiktionary_forms`, never on frequency data. Keep that separation
  deliberate.
- Coverage %, grid, and difficulty recompute automatically (live queries, no
  stored snapshots). Dropped lemmas leave harmless orphan `known_lemmas`
  rows that stop counting; new lemmas appear as unknown.
- The real risk is the headline number moving — including down — against the
  "stable, monotonically improving" motivation principle. Similar-corpus
  revisions barely move it (Zipf mass concentrates in the stable head); a
  source swap can shift points. Defenses: a `version`/`built_at` column on
  `lemma_ranks` so swaps are explicit events, and — if a progress-over-time
  chart ever exists — **snapshot the % at compute time** so history is never
  retroactively rewritten by a data swap.
- Replacing the Wiktionary side (a newer kaikki dump) is routine:
  TRUNCATE + reload is the loader's normal mode; a changed mapping affects
  only future matches, never past events.

## Technical decisions (index)

1. **Explicit checkpoint press; never automatic crediting.** Skim/rewatch
   safety; consistent with reading mode's implicit-goods firing only on the
   explicit advance. The label is the comprehension assertion ("I've
   followed up to here" + count badge); "N reviews collected" is the result
   toast, not the button's promise.
2. **Checkpoint anchored to the furthest-read pointer** (web) / playback time
   (extension); new monotonic `reviewed_until_segment_index` per session;
   `furthest_read_segment_index` stays a pure scroll tracker.
3. **Implicit `good`, `was_explicit = false`, review-state due facets only**
   (`srs_state IN ('new','review')`, due, enabled, ready, unparked — the
   review-budget predicate). Learning/relearning, parked, and disabled
   facets are never touched by implicit evidence. Exposure below that bar is
   genuine reinforcement but not gradable; it persists only as encounter
   aggregates.
4. **Checkpoint credits count toward the daily review budget** (provenance
   `practice_rating_events.study_session_id`): completed review work
   replaces that day's flashcard load. The budget never blocks a checkpoint
   (only the served queue is budget-gated). Lesson-import lapses stay
   exempt — those *create* work.
5. **Recognition citation facets only in v1**; optional surface-exact
   form-facet credit later; pronunciation never credited by silent reading.
6. **Per-checkpoint batch undo** through the existing `reverted_at`
   machinery; immediate undo sidesteps the latest-event-snapshot constraint.
7. **Gloss/highlight = suppression only — never an inferred
   `hard`/`again`**; preview glosses suppress too. Lookups can be nuance
   checks, and "looking is free" must never become "looking is punished."
8. **Checkpoint passes refresh `last_encountered_at` without bumping
   `encounter_count`** (decay stays honest; tier-1 demand stays reserved for
   deliberate re-saves), plus cheap per-lookup aggregates
   (`content_encounter_count`, `last_content_encounter_at`). No
   per-occurrence event log.
9. **Matching reuses `wiktionary_forms` + a folded expression index +
   a stub-redirects table** — no separate `form_to_lemma` megatable. Folds
   byte-pinned against the offline build. Fallback: build the separate table
   (~110–130 MB/language) only if query-time folding shows quality problems.
10. **Hard language gate** (loaded dumps only), no FTS degradation.
11. **Per-language headword→lemma fold** for LLM-normalized headwords.
12. **Sense check only for headwords with 2+ saved senses** (enumerable from
    the vocab key); Haiku batch pass with segment context.
13. **MWE = liberal recall filter → Haiku confirm**; contiguous n-gram
    matching rejected (misses discontiguity/reordering).
14. **`known_lemmas` correction = read-time precedence (studied > known),
    never delete-on-save** — the sense-blind lemma key makes deletion wrong
    for the different-sense case.
15. **Un-mark affordances:** gloss-sheet chip (single) + per-checkpoint
    `source_id` (bulk).
16. **Ghost nomination never reads `known_lemmas`** — suppressed suggestions
    are invisible errors; coverage miscounts are visible ones.
17. **Backlog "I know this" = generous-seed review-state entry**
    (`KNOWN_ASSERT_STABILITY = 10` → first verification ≈ 3 weeks out at
    recognition's 0.8 retention — not the ~4-day `easy` graduation),
    recognition-only, one user-facing action with two write paths:
    introduction (unseen/decayed) vs unpark + seed (onboarding-parked — exits
    onboarding; undo needs a re-park event extension for exact-state
    restore). Never consumes the daily-new budget in either direction: known
    assertions do NOT stamp `introduced_at` (mirrors `initializeFacet`'s
    convention for non-daily-capped introductions; the rating event is the
    historical record). Grouped opt-in in the checkpoint sheet — never
    automatic, and the list excludes terms saved this session or glossed in
    the span.
18. **Claimed vs verified coverage split**; a checkpoint credit is a
    verification event; seed + due-only guarantee verification is later,
    independent evidence; known-only lemmas stay claimed forever (no
    verification machinery on the stateless table).
19. **Difficulty = expected coverage with FSRS retrievability** as P(known)
    for studied terms; one blended headline number with the verified share
    as secondary detail; labeled by extensive-reading thresholds; explicitly
    vocabulary-only.
20. **Reference data stays in Supabase, untrimmed.** All read paths are
    indexed point lookups; future features want in-database joins with user
    tables; disk overage is ~$0.125/GB/mo (trivial at 20 languages); the
    verbatim JSONB is a paid-for insurance policy (etymology etc. without
    re-ingesting dumps). If a trim ever happens, it happens *before* a bulk
    language load (disk high-water mark doesn't shrink).
21. **`lemma_ranks` is versioned and swappable** (TRUNCATE + reload; user
    data references lemmas by text only); any future progress-over-time
    chart snapshots coverage at compute time.
22. **Two-lane checkpoint interaction:** reviews immediate + undo toast;
    claims (mark-known, backlog) behind one opt-in sheet.
23. **Extension checkpoint ships** (pause-state controls, deliberate press)
    — the evidence is the explicit press, not playback position; web reader
    first is sequencing, not principle.

## Deltas to `vocab-coverage-visualization.md`

- `form_to_lemma` runtime table → replaced by the folded index over
  `wiktionary_forms` (decision 6); `lemma_ranks` unchanged (offline build
  keeps all spike rules — the folds/weights become build-script logic).
- Mark-all-known still skips studied terms; the grouped backlog opt-in
  (decision 14) is a separate, explicit second step beside it.
- Open question "per-text undo for a careless bulk mark" → resolved:
  `source_id` + checkpoint-scoped un-mark.
- Open question "should passive signal auto-suggest known-marking" →
  superseded: the checkpoint press is the explicit entry point; nothing is
  passive.
- Open question "how much to trust bulk marks in the headline number" →
  resolved: claimed vs verified split (decision 15).

## Rollout

1. **Checkpoint reviews + backlog known-assertions** — no wordfreq
   dependency: folded index + redirects + fold helpers,
   `reviewed_until_segment_index`, the provenance column, reader-footer /
   end-of-content / extension affordances, per-checkpoint undo, and the
   backlog known-assertion opt-in (claims sheet, web-only — the extension
   ships reviews + undo chip only in this phase). Reader before extension
   within the phase (cheapest validation surface — sequencing only); MWE
   matching staged as an in-phase follow-up PR after single-word matching.
2. **`lemma_ranks` offline build** (wordfreq × kaikki, spike rules from the
   coverage proposal) + the difficulty stat on sessions.
3. **Grid + mark-known sweep** — the coverage proposal's product shape,
   riding on the same matcher, plus the claimed/verified split.

## Open questions

- Does surface-exact form-facet crediting ship in v1 or later? (Still open
  after phase 2 — deliberately deferred until phase 1's checkpoint matching
  has real-world signal, since it widens the SRS write surface.)
- ~~Where the difficulty stat surfaces~~ — resolved in phase 2: session cards
  (incl. TV episode rows) + the session header with a detail sheet; the
  source-wizard surface was skipped (wizard-less YouTube/streaming sessions
  would miss it; the session-keyed endpoint makes adding it later cheap).
