# A pronunciation pool + warm-up

> **Status: proposal — not implemented.** A design for giving the
> **pronunciation** facet its own exercise-graded practice surface and an
> exercise-first warm-up on-ramp, the same way recognition and production
> (both shipped; see `old-docs/production-warmup.md` for the latter's design)
> have. Not current behavior; `SPEC.md` and `docs/SRS.md` describe what ships —
> note the warm-up now serves through the composed practice queue, not the
> dedicated affordances this doc occasionally references. Surfaced while
> extending the warm-up on-ramp — pronunciation is the facet where "just
> generalize the warm-up" does **not** carry over cleanly, so it gets its own
> design.

## TL;DR

Pronunciation is the one facet where a warm-up ladder is **not** a flag flip,
because two prerequisites don't exist yet:

1. **There is no pronunciation *pool*.** Only two pools exist
   (`recognition ↔ meaning_recognition`, `production ↔ meaning_production` via
   `skillForPool` / `poolForSkill`). Pronunciation is a *third skill* that rides
   inside the recognition flashcard queue as a self-graded "Say it out loud"
   card — there is no exercise loop, no gate ladder, no parkable lifecycle.
2. **The exercise bank can't represent a pronunciation facet** (Trap 19). The
   `practice_exercise` bank is keyed `(user_lookup_id, pool, status)` with **no
   facet identity**, so a parked pronunciation facet would collide with the
   citation meaning facet on the pool-keyed bank. `leech-config.ts` deliberately
   excludes `pronunciation` from leechable facets for exactly this reason.

So the headline isn't "warm up pronunciation." It's **"give pronunciation an
exercise type at all"** — the warm-up then falls out of the shared
park → gate → graduate machinery for free, the same way it did for recognition.

## Why this is bigger than the production extension

The production warm-up extends an *existing* pool that already has a review loop
and a gate ladder (`mc_cloze → production_cloze`). Pronunciation has neither, so
this proposal is really two projects stacked:

- **Project A — pronunciation as a graded skill.** A deterministically-gradeable
  exercise type, a pool/queue decision, and the Trap-19 bank-key change.
- **Project B — the warm-up on-ramp.** Trivial *once* Project A makes
  pronunciation a parkable facet — it reuses `startWarmupSession` /
  `getStrengthenExercises` / `submitExerciseAnswer` verbatim.

Ship A first; B is the easy part.

## The core constraint: pronunciation is an audio skill, the gates are text-only

Gate exercises must be **deterministically graded** server-side (MC index
equality; production-cloze edit-distance). There is **no audio in the loop**:
no TTS to model the target (the "Say it out loud" flashcard chip is a prompt,
not a player — audio is roadmap), and no ASR to grade the learner's speech.

That splits "pronunciation" into two sub-skills, only one of which is buildable
deterministically today:

- **Receptive / IPA-literacy** — can the learner read the transcription, locate
  the stress? **Text + deterministic → buildable now.**
- **Productive / articulation** — can the learner actually *say* it? **Needs
  audio in and out → not deterministically gradeable; out of scope until TTS/ASR
  exist.**

This proposal scopes Project A to the **receptive** slice, and is explicit that
it is not a substitute for real articulation practice.

## Exercise ideas, strongest fit first

### 1. Stress placement (MC) — recommended first exercise type

For languages with mobile / unpredictable / lexically-distinctive stress —
**Russian is the killer case** (за́мок "castle" vs замо́к "lock";
ви́деть). The app already stores stress-marked `display_form` (Kaikki-grounded
for `ru`), so the answer key exists for free.

- **Prompt:** the word with the stress mark stripped, rendered as its syllables.
- **Options:** the word's own syllables (MC over syllable positions).
- **Answer:** the stressed syllable, derived deterministically from
  `display_form`'s U+0301 position.

Why it's the strongest fit:

- **Fully deterministic** — MC index equality, no LLM grading.
- **No LLM distractor generation** — the options *are* the syllables, so there's
  nothing for the GENERATE → VERIFY pipeline to get wrong (unlike `mc_cloze`,
  whose distractors are the hard part). Generation is deterministic, like
  `use_in_sentence` payloads.
- **No audio needed.**
- **Reuses existing data** — stress-marked `display_form`.
- **High pedagogical value** — stress is the single hardest
  deterministically-testable thing about Russian.

Scope it to languages where stress is marked and contrastive (Russian first;
the per-language allowlist already exists in
`packages/core/src/constants/language-grammar.ts`). For languages with fixed /
predictable stress (e.g. French, Polish-final), this exercise type simply
doesn't generate.

### 2. Word ⇄ IPA match (MC)

Show the IPA, pick the headword from four; or show the headword, pick the correct
IPA. Deterministic on grading, but **weaker**:

- Distractors are *plausible-wrong IPA*, which is harder to generate and verify
  than wrong-word distractors (the VERIFY pass would need a phonology check).
- It tests IPA-*reading literacy* more than pronunciation per se.

Worth it only for the Kaikki-IPA languages (`ru`, `en`, `de`) where a grounded
IPA answer key exists. Consider it a tier-2 escalation, not the entry rung.

### 3. Minimal-pair discrimination / listen-and-type — deferred (needs audio)

The genuinely pronunciation-adjacent exercises (hear two near-identical words,
pick which was said; hear a word, type it) all require TTS and possibly ASR.
**Park until audio infra lands** — they're the right exercises for real
articulation practice, but they can't be built deterministically today.

## The pool/queue decision (Project A)

Two viable shapes; pick one before building:

- **Option P1 — pronunciation becomes a third pool.** `skillForPool` /
  `poolForSkill` gain `pronunciation ↔ pronunciation`. Cleanest conceptually and
  makes the warm-up/rehab machinery apply verbatim (`pool` already threads
  everywhere), but it's a wide change — `practice_session.pool`, due-summary
  splits, review caps, contracts, and the language-screen UI all currently assume
  exactly two pools.
- **Option P2 — pronunciation stays a recognition-queue rider, gated
  separately.** Less invasive to the pool plumbing, but then the exercise
  bank's `pool` key still can't tell a pronunciation gate from a meaning gate —
  which is **exactly Trap 19** — so this option still forces the bank-key change
  below and is arguably the worse of the two.

**Recommendation: P1** — if pronunciation is going to be exercise-graded and
parkable, making it a real pool is the honest model and lets warm-up/rehab fall
out for free. Budget for the two-pools-everywhere assumptions it breaks.

## Prerequisite: fix Trap 19 (give the bank facet identity)

Independent of P1 vs P2, the `practice_exercise` bank must be able to hold a
pronunciation facet without colliding with the meaning facet on the same term.
Today the key is `(user_lookup_id, pool, status)`. Options:

- Add `skill` (and `target_form`) to the bank's identity so each facet owns its
  own slots, OR
- if P1 is chosen and pronunciation is a distinct `pool`, the existing
  `(user_lookup_id, pool, status)` key already disambiguates meaning vs
  pronunciation **for the citation form** — but form-level pronunciation facets
  (a future want) would still collide, so adding facet identity is the durable
  fix.

This is a schema migration (append-only, per repo policy) plus updates to
`practice-exercises-repository.ts` and the `ensure` / fencing logic.

## Sketch of the change (once A's shape is chosen)

Backend:

- **Migration:** widen the `practice_exercise` identity to include `skill`
  (+ `target_form`), backfilling existing rows as `meaning_recognition` / `''`.
- **New exercise type** `stress_placement` (deterministic generation from
  `display_form`; `gate_eligible = true`). Add it to the pronunciation pool's
  gate ladder. No GENERATE/VERIFY LLM cycle — the payload is computed.
- **Pool wiring (P1):** `skillForPool('pronunciation') = 'pronunciation'`,
  reverse map, and let `practice_session.pool` / due-summary / review-caps accept
  the third value.
- **Grading:** MC index equality (already exists). Graduation reuses
  `advanceRehabDay` / `unparkAndSoftReentryFacet` unchanged.
- **Park method:** `initializeAndParkPronunciationCitationFacet(...)` — like the
  production one, **no daily-new cap** (pronunciation is opt-in), eligible iff the
  `(pronunciation, '')` facet is enabled, `srs_state IS NULL`, not parked. The
  readiness guard must require **displayable IPA / a derivable stress position**
  (a term with no stress data can't be stress-tested — it should fall through, not
  hang on a `generating` placeholder; reuse the C fallback / terminal-failure
  surfacing from the recognition warm-up).
- **Due-summary:** `pronunciationWarmupCount` / `pronunciationParkedCount`,
  mirroring the recognition onboarding/leech split.

Frontend:

- A pronunciation warm-up affordance on the language screen
  ("N pronunciation terms warming up — continue") gated on
  `pronunciationWarmupCount > 0`, reusing `ExerciseSessionView` with
  pronunciation copy.
- A `StressPlacementExercise` component (syllable-button MC); the rest of the
  exercise-session shell is shared.

## Open questions

- **Is the receptive slice worth shipping without articulation?** A stress-quiz
  for Russian is genuinely useful (and the data is free), but it is *not*
  pronunciation production. Decide whether that's an honest "pronunciation
  practice" surface or whether it should be labelled more narrowly (e.g.
  "Stress" / "Reading IPA") so we don't over-promise.
- **P1 vs P2** — is pronunciation worth being a first-class third pool, or is the
  blast radius of "three pools everywhere" too large for the value?
- **Which languages?** Stress placement is high-value for Russian, marginal for
  fixed-stress languages, undefined for English (lexical stress exists but isn't
  marked in our data). Word⇄IPA match needs grounded IPA (`ru`/`en`/`de`). The
  exercise type should generate only where the data supports a deterministic
  answer key.
- **Sequencing vs production warm-up.** Production warm-up shipped first (the
  smaller, more coherent step); pronunciation is a larger track.

## Relationship to existing docs

The shipped warm-up (recognition + production) and the leech-rehab mechanic live
in `docs/SRS.md` and `SPEC.md` (Practice / Strengthen); the production design
rationale is archived at `old-docs/production-warmup.md`. This doc is the
pronunciation track, which additionally requires a new graded skill and a
bank-key change before any warm-up can hang off it. Pull any of this into the
specs only when it ships.
