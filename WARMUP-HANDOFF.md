# Handoff — Exercise-first warm-up (+ loading-UX fixes + warm-up/leech split)

> **Status:** implemented on the working branch, verified locally (typecheck, lint,
> backend tests all green) against the dev-tunnel DB. **Not yet committed/PR'd.**
> Docs + translations are intentionally deferred to PR time (see "Deferred").
>
> Source plan: `~/.claude/plans/i-think-that-we-quizzical-pebble.md` (model C —
> generalize the leech-rehab graduation into an onboarding on-ramp). This file
> records what shipped, including changes made *beyond* the plan during testing.

## TL;DR

A new **warm-up** flow introduces brand-new kept terms through scaffolded
exercises *before* they become flashcards, reusing the existing leech-rehab
machinery (park → gate exercises → graduate after correct answers on 3 distinct
days → soft re-entry into FSRS). "Onboard a new term" and "rehab a leech" are the
same operation entered from opposite directions; they share one DB
representation and are told apart purely by derivation:

- **onboarding (warm-up):** `leech_parked_at IS NOT NULL AND srs_state IS NULL`
- **leech (rehab):** `leech_parked_at IS NOT NULL AND srs_state IS NOT NULL`

No schema migration was needed for any of this.

## Three shipping rounds

### Round 1 — the warm-up feature (the plan)

From the session-vocabulary footer ("Practice your terms"), the user launches an
exercise-only, session-scoped warm-up that parks the session's not-yet-introduced
kept terms into scaffolding (consuming the daily new-term budget, atomically) and
serves them gate exercises. Everything downstream of "park" is existing code.

**Backend**
- `transport/database/study-facets/study-facets-repository.ts`
  - `initializeAndParkCitationFacetIfUnderDailyCap(...)` — **atomic** init+park in
    one tx under the per-(user,lang) advisory lock; SELECT-then-decide → returns
    `'scaffolded' | 'cap_reached' | 'not_eligible'`. Stamps `introduced_at` +
    `leech_parked_at`, **leaves `srs_state` NULL** (so the term reads as
    never-reviewed → the onboarding derivation stays clean).
  - `listSessionKeptCitationFacets(studySessionId)` — resolves a session's kept
    terms via the canonical `cards.user_lookup_id` FK (DISTINCT ON), returning each
    citation recognition facet's `srsState`/`leechParkedAt`/`disabledAt`.
- `service/practice/warmup.ts` (new) — `startWarmupSession(...)`: validate session
  (ownership + language), enter eligible terms (`cap_reached` stops + flags
  `dailyLimitReached`; `not_eligible` is skipped, **never** a cap hit), serve via
  `getStrengthenExercises` scoped to the union of already-onboarding + newly
  scaffolded terms (resume-safe).
- `service/practice/exercise-bank.ts` — `getStrengthenExercises` gained
  `restrictToUserLookupIds`, threaded into `listParkedTerms`.
- `transport/database/user-lookups/user-lookups-repository.ts` —
  `listParkedTerms` gained `restrictToUserLookupIds`; **due-summary fix**: added
  `leech_parked_at IS NULL` to `new_count`/`production_new_count` (a warm-up term
  is parked + `srs_state` NULL, which the old counts would have wrongly advertised
  as "new available").
- `router/practice-router/practice-router.ts` + `app.ts` — `startWarmupSession`
  handler; `studySessionsRepository` added to `PracticeRouterDependencies` and
  wired.
- `packages/api-client/.../practice-contract.ts` — `startWarmupSession`
  (`{studySessionId, targetLanguage}` → `{exercises, dailyLimitReached}`).
- Answer submission **unchanged** — warm-up exercises are real `gate_eligible`
  exercises, so the existing `submitExerciseAnswer → applyGateAnswer →
  advanceRehabDayFacet → unparkAndSoftReentryFacet` graduation path already does
  the right thing.

**Frontend**
- Extracted `features/practice/components/exercise-session-view.tsx` (shared
  queue/render) out of `strengthen-view.tsx`; `StrengthenView` is now a thin
  wrapper. New `warmup-view.tsx` + route
  `app/routes/_authenticated/_app/practice/warmup/$targetLanguage.tsx`.
- `strengthen-types.tsx` — `ExerciseCopyVariant ('rehab'|'warmup')`;
  `RehabProgressNote` takes `copyVariant`. Threaded through `mc-exercise.tsx` /
  `production-cloze-exercise.tsx` (option (a) from the plan — smaller than
  hoisting, keeps the note in the result block).
- `features/practice/api/practice-hooks.ts` — `useStartWarmupSession`.
- `features/review/components/session-vocabulary-view.tsx` — footer button now
  navigates to `/practice/warmup/$targetLanguage` (was `/practice/review/...`).

### Round 2 — loading-UX fixes (reported during testing)

A term (`кадырман`) hung on an eternal "generating" hourglass. Root causes found
in the live DB: every `mc_cloze` generation **failed the verifier** (the headword
is non-standard Russian — should be `кадыровец`), and the tier-0 ladder was locked
to `mc_cloze` even though a ready, gate-eligible `mc_comprehension` existed. Three
fixes (user picked C+A+B, not D):

- **C — failure-tolerant gate ladder** (`exercise-bank.ts`): try the tier's
  preferred type, then **fall back to any ready gate-eligible exercise**.
  Graduation is gated on N distinct days, not a strict type sequence.
- **B — surface terminal failure**: new repo method
  `practice-exercises-repository.ts#countGateBankSlots` (`{inflight, failed}` over
  the pool's gate-capable types). Serve logic now distinguishes still-cooking
  (`generating`) from **terminally exhausted** (`failed` — no ready, none in
  flight, ≥1 failed) and **stops re-reserving doomed slots**. New
  `'failed'` value on `StrengthenExerciseEntry.status` →
  "couldn't prepare — skip" UI instead of an endless hourglass.
- **A — live-update placeholders**: serve-only `refreshWarmupSession` endpoint
  (no parking/introductions, safe to poll). `ExerciseSessionView` now holds a
  local queue and, while a `generating` entry is ahead, **polls every 4s and
  swaps placeholders in place** (`mergePlaceholders`). `useRefreshWarmupSession`
  hook; `WarmupView` provides `pollExercises`. (Strengthen does not poll —
  unchanged.)

### Round 3 — warm-up vs leech split on the Practice tab (reported confusion)

A warm-up term showed "REHAB" when entered from the Practice tab's "N parked —
strengthen them" button but "WARM-UP" from session-vocab. Cause: the general
Strengthen surface lumped onboarding + leech terms together with rehab copy. The
user chose **Option 1 (two affordances)**.

- `user-lookups-repository.ts` — `listParkedTerms` gained
  `parkedOrigin: 'onboarding' | 'leech'` (filters on `srs_state IS NULL` vs
  `IS NOT NULL`). `listDueSummary` now splits recognition parked into
  **`parkedCount`** (leech-only) + new **`warmupCount`** (onboarding); both added
  to `DueSummaryEntry` and `PracticeDueSummaryEntrySchema`.
- `exercise-bank.ts` — `getStrengthenExercises` passes `parkedOrigin` through.
- `practice-router.ts` — Strengthen now requests `parkedOrigin: 'leech'`
  (genuine leeches only); new **`continueWarmupSession`** handler.
- `warmup.ts` — start/refresh pass `parkedOrigin: 'onboarding'`; new
  language-scoped, serve-only `continueWarmupSession(...)` (every onboarding-parked
  term for the language — resume an abandoned warm-up from the Practice tab).
- `practice-contract.ts` — `continueWarmupSession` (`{targetLanguage}` →
  `{exercises}`).
- Frontend: `useContinueWarmupSession` hook; new `warmup-continue-view.tsx` +
  route `.../practice/warmup-continue/$targetLanguage.tsx` (reuses
  `ExerciseSessionView`, warm-up copy, same polling). `practice-language-view.tsx`
  now renders a sky **"N term(s) warming up — continue"** affordance above the
  violet leech **"N word(s) parked — strengthen them"**. `practice-landing-view.tsx`
  summary splits "N warming up" from "M parked".

## New/changed API surface (oRPC `practice` contract)

| method | shape | notes |
|---|---|---|
| `startWarmupSession` | `{studySessionId, targetLanguage}` → `{exercises, dailyLimitReached}` | session-scoped; parks new terms |
| `refreshWarmupSession` | `{studySessionId, targetLanguage}` → `{exercises}` | serve-only poll for a session warm-up |
| `continueWarmupSession` | `{targetLanguage}` → `{exercises}` | serve-only, language-wide; resume from Practice tab |
| `StrengthenExerciseEntry.status` | added `'failed'` | terminal-generation state |
| `PracticeDueSummaryEntry` | added `warmupCount`; `parkedCount` now leech-only | recognition split |

## Routes added
- `/practice/warmup/$targetLanguage` (search: `studySessionId`)
- `/practice/warmup-continue/$targetLanguage`
- `routeTree.gen.ts` regenerated.

## Tests
- `service/practice/warmup.unit.test.ts` — eligibility selection, validation,
  cap-vs-race disambiguation, resume, `continueWarmupSession` language-wide serve.
- `service/practice/exercise-bank.unit.test.ts` — fallback (C),
  terminal-failed-no-re-reserve (B), in-flight, cold-bank, `parkedOrigin`
  passthrough.
- Full backend suite: **451 passed / 1 skipped**. `pnpm check:types` ✅,
  `pnpm lint` ✅ (0 errors).

## Verification notes (dev-tunnel)
- `кадырман` had a ready gate-eligible `mc_comprehension`; the C fallback now
  serves it instead of hanging.
- User's 7 parked Russian terms are all warm-ups (`srs_state` NULL), 0 leeches →
  the language screen shows "7 term(s) warming up — continue" and no "strengthen
  them" line.

## Deferred / not done
- **Docs:** `docs/SRS.md` (§3/§4 queueing, §7 leech rehab) and `SPEC.md`
  (Practice/Strengthen) need the warm-up entry trigger + the onboarding/leech
  derivation. Do at PR time via the `create-pr` / `update-docs` flow.
- **Translations:** new Lingui strings are English-only; `pnpm translate:sync`
  runs at PR time.
- **Option D (refresh-resume):** F5 still restarts a warm-up queue at 1/N
  (rehab day-credit is server-side, so no graduation progress is lost — only the
  within-sitting position). Deliberately deselected.
- **Strengthen polling:** only warm-up polls placeholders; Strengthen could reuse
  the same `pollExercises` plumbing later.
- **Root cause upstream:** the basic-data pass normalized the highlight to the
  non-word `кадырман` (should be `кадыровец`). The exercise layer now degrades
  gracefully around bad headwords, but the vocabulary entry itself is still
  wrong — a separate enrichment/normalization issue.
