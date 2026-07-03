# Warm up production terms too

> **Status: historical** (archived 2026-07-03). This proposal SHIPPED in PR #185
> (production warm-up alongside recognition); the entry points it sketches were
> then absorbed by the composed practice queue (PR #186). Current behavior lives
> in `SPEC.md` (Practice / Strengthen) and `docs/SRS.md`. Kept for the design
> rationale, notably the "Exact-form warm-up" section (Trap 19 / exercise-bank
> facet identity), which is still unbuilt and referenced by
> `docs/proposals/pronunciation-warmup.md`.

## Problem / motivation

The warm-up flow introduces a brand-new term through scaffolded gate exercises
(park → tier-escalating exercises → graduate after correct answers on 3 distinct
days → soft re-entry into FSRS) instead of straight into the flashcard queue. It
is **recognition-only**: it hangs off the citation `meaning_recognition` facet.

- `service/practice/warmup.ts` always serves `pool: 'recognition'`.
- `study-facets-repository.ts#initializeAndParkCitationFacetIfUnderDailyCap`
  hard-codes `skill = 'meaning_recognition'`.
- Warm-up eligibility (`listSessionKeptCitationFacets`) `LEFT JOIN`s only the
  `meaning_recognition` citation facet, so `hasFacet` is true only when that
  facet exists.

Consequences for production:

- A **production-only** term (user selected Production but not Recognition in
  the study-target picker) has no `meaning_recognition` facet → `hasFacet=false`
  → it is **skipped by warm-up** entirely and goes straight into the production
  flashcard queue as a `new` card.
- A **Recognition + Production** term enters warm-up, but only the recognition
  facet is scaffolded; the `meaning_production` facet is untouched and enters the
  production queue cold.

This is the *more* interesting gap: production (free recall / typing) is the
harder skill, so a gentle scaffolded on-ramp arguably helps more there than for
recognition. And the machinery is mostly pool-generic already — the production
gate ladder exists (`mc_cloze → production_cloze → production_cloze`), and
`listParkedTerms` / `getStrengthenExercises` already take `pool` and
`parkedOrigin`.

## Why it's not a trivial flag flip

Warm-up's recognition-specific assumptions don't all carry over:

1. **Daily-new cap.** Recognition warm-up consumes the daily new-term budget on
   entry, atomically (`initializeAndParkCitationFacetIfUnderDailyCap`). Production
   introductions are **not** daily-capped (production is an explicit opt-in;
   `isDailyNewCappedFacet` is recognition-citation only). So a production warm-up
   park is *simpler* — no cap, no `cap_reached`/`dailyLimitReached` — but it needs
   its own park method that stamps `leech_parked_at` on the `meaning_production`
   citation facet, leaves `srs_state` NULL, and does **not** touch the recognition
   daily-new accounting.

2. **`srs_state IS NULL` onboarding derivation.** The onboarding-vs-leech split
   (`parkedOrigin`) keys on `srs_state IS NULL`. A production facet enabled but
   never practiced already has `srs_state = NULL`, so a parked production facet
   with NULL state reads as "onboarding" — good, the derivation generalizes. But
   the due-summary split (`warmupCount` vs `parkedCount`) is currently computed
   on the **recognition** facet only; production parked terms all count as
   `productionParkedCount` regardless of origin. A production warm-up needs the
   same onboarding/leech split mirrored onto the production facet
   (`productionWarmupCount`).

3. **Entry point / UI.** The recognition warm-up is launched from the
   session-vocabulary "Practice your terms" button (recognition-flavored) and
   from the Practice tab's "N terms warming up — continue" affordance. Production
   warm-up needs its own surface — most likely a second affordance on the
   language screen ("N production terms warming up — continue") and a decision
   about whether the session-vocab button warms recognition only, or both pools
   when a term has both facets.

4. **What does the session-vocab button warm?** For a term saved with both
   Recognition + Production, should "Practice your terms" warm both facets at
   once (two parked facets, two ladders), or stay recognition-first and let
   production warm-up be a separate, deliberate act? Warming both at once doubles
   the exercise volume per term on day one; recognition-first is gentler but
   means production is never auto-warmed.

## Sketch of the change

Backend:

- New park method `initializeAndParkProductionCitationFacet({ userLookupId,
  userId, targetLanguage })` (no daily-new cap): SELECT-then-decide on the
  `(meaning_production, '')` facet — eligible iff enabled, `srs_state IS NULL`,
  not parked; stamp `leech_parked_at`, leave `srs_state` NULL. Returns
  `'scaffolded' | 'not_eligible'` (no `cap_reached`).
- Generalize `listSessionKeptCitationFacets` (or add a production sibling) to
  return the `meaning_production` citation facet state, so session-scoped
  production warm-up can pick eligible terms.
- `service/practice/warmup.ts`: a production variant (or a `pool` param) that
  serves `pool: 'production'`, `parkedOrigin: 'onboarding'`. The production gate
  ladder and the existing `submitExerciseAnswer → applyGateAnswer` graduation
  path already do the right thing per pool (`skillForPool`, `gateTypeForTier`).
- Due-summary: add `productionWarmupCount` and make `productionParkedCount`
  leech-only (mirror of the recognition split already shipped).

Contract / hooks:

- `continueWarmupSession` (and the session-scoped start/refresh) gain a `pool`
  (default `recognition`), or add `continueProductionWarmupSession`.

Frontend:

- Language screen: a production warm-up affordance gated on
  `productionWarmupCount > 0`, opening the warm-up view with production copy.
- Decide the session-vocab button behavior (recognition-first vs warm both).

## Open questions

- Should production warm-up be **automatic** for a newly-kept production term, or
  always a deliberate opt-in from the Practice tab? (Recognition warm-up is
  itself opt-in today — launched from the session-vocab button — so "opt-in" is
  consistent.)
- For a term with both facets, do we want **one** warm-up that drills both skills
  interleaved, or two independent ladders? Interleaving is closer to real
  learning but complicates the per-term queue and the graduation bookkeeping
  (two facets, two day-counts).
- Is `production_cloze` (typed) too hard as a *first* contact for a brand-new
  term? The ladder starts at `mc_cloze` (MC) and only escalates to typed
  production at tier 1, which may already be the right gentleness curve — worth
  validating once it ships.

## Exact-form warm-up (later, not in the first cut)

The citation production warm-up above warms only the lemma facet
`(meaning_production, '')`. Warming an **exact form** (`target_form != ''`) — so a
production-only inflected save gets scaffolded too — is a strictly larger change,
because the exercise bank has no facet identity (Trap 19).

The `practice_exercises` table keys everything on `(user_lookup_id, pool)`: no
`target_form` column, both indexes
(`(user_lookup_id, pool, status)`, `(user_id, target_language, pool)`) and the
advisory lock (`practice_exercises:${userLookupId}:${pool}`) omit it, and every
repository query (`ensureExerciseBank`, the stale-fence, the live-type SELECT,
INSERT, `serveReadyForTerms`, `countReady`, consume-on-answer,
`countGateBankSlots`) filters by `(user_lookup_id, pool)`. So a form facet cannot
own bank slots without colliding with the citation facet — the same reason form
facets never leech (`isLeechableFacet` requires `target_form === ''`).

The work splits cleanly into two halves of very different difficulty:

**Half 1 — thread `target_form` everywhere (wide but mechanical, low-risk).**
- Append-only migration: add `target_form text NOT NULL DEFAULT ''`, backfill
  existing rows to `''`, widen both indexes to include it.
- `practice-exercises-repository.ts`: add `target_form` to every WHERE/INSERT
  (~8 queries) and to the advisory-lock key.
- `exercise-bank.ts` + `listParkedTerms`: operate per-facet `(skill,
  target_form)` instead of per-`(lookup, pool)`.
- `leech-config.ts`: relax `isLeechableFacet`'s `target_form === ''` restriction.
- `StrengthenExerciseEntry`: add `targetForm` (on top of `pool`) and merge the
  client queue by `(pool, targetForm, userLookupId)`.
- Graduation (`applyGateAnswer → advanceRehabDayFacet →
  unparkAndSoftReentryFacet`) already operates on a `(skill, target_form)` facet,
  so once the exercise row carries `target_form` it mostly just works.

This is essentially find-and-replace plus tests — a focused PR.

**Half 2 — form-aware exercise *generation* (the genuinely hard part).**
- `generate-exercise-pass` works from `headword + sense` today. A form exercise
  must test the **inflected** form: the cloze blank is the exact form, distractors
  are other inflections, and the VERIFY pass must enforce inflection-unambiguity
  for *that* form. New prompt + verification design, not plumbing.
- The generation input needs the form's data (`display_form`, the form's example)
  from `study_facets.payload`, which only exists once the form facet is `ready`.
  A `pending_data` form has nothing to generate from, so form warm-up has an
  ordering dependency: run the `generate-form-data` Opus pass *before* the form
  can be parked + exercised.

**Sizing & sequencing.** Roughly **2–3× the citation production warm-up**, with
the cost front-loaded into infrastructure that is reusable: **Half 1 is the same
Trap-19 bank-key change the pronunciation track needs**
(see `pronunciation-warmup.md` → "fix Trap 19"). Do it once and both exact-form
*and* pronunciation warm-up build on it. Half 2 carries the real uncertainty
(form-specific generation + the `pending_data` ordering), so it should land as its
own PR after Half 1. Recommended order: ship citation production warm-up first
(no schema change), then the shared Trap-19 facet-identity PR, then exact-form and
pronunciation on top.

## Relationship to existing docs

The shipped recognition warm-up is described in `docs/SRS.md` (leech-rehab /
warm-up on-ramp) and `SPEC.md` (Practice / Strengthen). This proposal is the
production extension of that same mechanic; pull it into those specs only when it
ships.
