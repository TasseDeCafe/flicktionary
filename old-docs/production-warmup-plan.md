# Production warm-up — implementation plan

> **Status: historical** (archived 2026-07-03). Implementation plan for the
> production warm-up, which SHIPPED in PR #185; parts of it (the `pool` param on
> `continueWarmupSession`, the language-wide warm-up-continue affordance) were
> superseded before or by the composed practice queue (PR #186). Current behavior
> lives in `SPEC.md` (Practice / Strengthen) and `docs/SRS.md`. Design rationale:
> `old-docs/production-warmup.md`.

## Context

The recognition warm-up parks a brand-new kept term into scaffolding and serves
gate exercises before it becomes a flashcard (park → tier-escalating gate
exercises → graduate after correct answers on 3 distinct days → soft re-entry
into FSRS). It is recognition-only today. This plan extends the exact same
mechanic to the production pool.

Most of the machinery is already pool-generic: `getStrengthenExercises`,
`listParkedTerms`, and the whole graduation path
(`submitExerciseAnswer → applyGateAnswer → advanceRehabDayFacet →
unparkAndSoftReentryFacet`) already take `pool` / `parkedOrigin` and dispatch the
facet via `skillForPool`. So this is mostly: one new park method, generalizing
the three warm-up functions, and one due-summary split — not new infrastructure.

## Key decision (locked)

**The session-vocabulary "Practice your terms" button parks BOTH pools.**

For the session's kept terms, `startWarmupSession` parks both the recognition
facet (daily-capped, existing method) and the production facet (uncapped, new
method). A term saved with both skills gets both ladders; a production-only term
(Production selected, not Recognition) is parked via its production facet and so
finally has a warm-up path (today it is skipped entirely and enters the
production flashcard queue cold).

- **Tradeoff accepted:** a both-skills term serves *two* gate ladders from day
  one, doubling its day-one exercise volume. The mixed queue interleaves them.
- **Rejected alternative:** keeping session-vocab recognition-only and adding a
  separate "Warm up production" park-on-demand action on the Practice tab — more
  new backend surface (a fresh language-wide eligibility scan), deliberately not
  chosen.

## Entry points

| Surface | Function | Pools | Behavior |
|---|---|---|---|
| Session-vocab "Practice your terms" | `startWarmupSession` | both | parks recognition (capped) + production (uncapped) for the session's kept terms; serves a **mixed queue** |
| Session-vocab poll (placeholders) | `refreshWarmupSession` | both | serve-only re-fetch of the session's onboarding-parked terms, both pools |
| Practice tab — "N terms warming up — continue" | `continueWarmupSession({ pool: 'recognition' })` | recognition | language-wide serve-only resume |
| Practice tab — "N production terms warming up — continue" (NEW) | `continueWarmupSession({ pool: 'production' })` | production | language-wide serve-only resume |

**Grading routing is already pool-safe**: each `practice_exercise` row carries
its own `pool`, so `submitExerciseAnswer` looks the exercise up by id and applies
the gate to the correct facet — no client pool info needed for *answering*.

**But the client queue identity is NOT pool-safe today** and must be fixed.
`StrengthenExerciseEntry` has no `pool` field
(`apps/backend/src/service/practice/exercise-bank.ts:182`,
`packages/api-client/src/orpc-contracts/common/flicktionary-schemas.ts:599`), and
the placeholder-merge keys by `userLookupId` alone
(`apps/web/src/features/practice/components/exercise-session-view.tsx:26,30`). A
both-skills term parked into both pools yields **two entries with the same
`userLookupId`** (one recognition, one production); during polling
`mergePlaceholders` would match a fresh exercise to the wrong placeholder and
could overwrite both with one pool's exercise. Required fix (see Contract +
Frontend below): add `pool` to `StrengthenExerciseEntry` and merge by
`(pool, userLookupId)`.

## Backend changes (`apps/backend/src`)

### 1. `transport/database/study-facets/study-facets-repository.ts`

- **New** `initializeAndParkProductionCitationFacet({ userLookupId, userId,
  targetLanguage }): Promise<'scaffolded' | 'not_eligible'>`
  - SELECT-then-decide on the `(meaning_production, '')` facet under the existing
    per-(user, language) advisory lock.
  - Eligible iff: facet exists, **enabled** (`disabled_at IS NULL`),
    `srs_state IS NULL`, `leech_parked_at IS NULL`.
  - Action: stamp `leech_parked_at = now()`, leave `srs_state` NULL, **leave
    `introduced_at` untouched** (production is not daily-capped —
    `isDailyNewCappedFacet` is recognition-citation only, so there is no budget
    to consume and no `cap_reached` branch).
  - Mirrors `initializeAndParkCitationFacetIfUnderDailyCap` minus all the
    daily-cap accounting.
- **Generalize** `listSessionKeptCitationFacets(studySessionId)` to take a
  `skill: FacetSkill` argument (default `'meaning_recognition'` to preserve
  callers), joining `(skill, '')` so the production warm-up can pick eligible
  terms from the same session. (Alternatively add a `meaning_production` sibling;
  prefer the param to avoid duplication.)

### 2. `service/practice/warmup.ts`

- `startWarmupSession(...)`: park the session's kept terms in **two independent
  passes** — the two pools must not share a stop condition:
  - **Recognition pass** (daily-capped): for each eligible term call
    `initializeAndParkCitationFacetIfUnderDailyCap`. The **first** `cap_reached`
    stops *further recognition* entries and sets `dailyLimitReached` — exactly the
    existing behavior.
  - **Production pass** (uncapped): independently, for every eligible term call
    the new `initializeAndParkProductionCitationFacet`. This pass **never stops on
    the recognition cap** — a recognition cap hit on term 1 must not prevent
    parking the production facet of term 2+. It never sets `dailyLimitReached`.

  Then serve a **concatenated** queue:
  `getStrengthenExercises({ pool: 'recognition', parkedOrigin: 'onboarding',
  restrictToUserLookupIds }) ++ getStrengthenExercises({ pool: 'production',
  parkedOrigin: 'onboarding', restrictToUserLookupIds })`.
  `dailyLimitReached` reflects the recognition cap only.
- `refreshWarmupSession(...)`: serve-only; fetch the session's onboarding-parked
  terms for **both** pools (`restrictToUserLookupIds` from the session's kept
  terms) and concatenate. No parking, safe to poll.
- `continueWarmupSession(...)`: gains `pool: PracticePool` (default
  `'recognition'`). Language-wide serve-only of every onboarding-parked term for
  that pool (no `restrictToUserLookupIds`). The two Practice-tab affordances call
  it once per pool.

### 3. `transport/database/user-lookups/user-lookups-repository.ts` — `listDueSummary`

`productionWarmupCount` is **three** edits in this file, not just the SQL — the
count must flow through the query, the row type, and the mapper:

1. **SQL** (the aggregate query, ~`user-lookups-repository.ts:120`): add a
   `production_warmup_count` aggregate — production facet
   (`skill='meaning_production', target_form=''`) with
   `disabled_at IS NULL AND leech_parked_at IS NOT NULL AND srs_state IS NULL`.
   In the **same** edit, change the existing `production_parked_count` to also
   require `srs_state IS NOT NULL` (leech-only), mirroring the recognition
   `warmup_count`/`parked_count` split. **Backward-safe**: no production warm-ups
   exist yet, so every currently-parked production row is a genuine leech and the
   count is unchanged on existing data.
2. **Row type** — add `productionWarmupCount: number` to the `DueSummaryEntry`
   (the repo's row type the query maps into).
3. **Row mapper** (~`user-lookups-repository.ts:590`): map the new
   `production_warmup_count` column into `productionWarmupCount`.

`listParkedTerms` already takes `pool` + `parkedOrigin` → no change (the
production warm-up reads it with `pool: 'production', parkedOrigin: 'onboarding'`).

### 4. Graduation path — no change

`submitExerciseAnswer → applyGateAnswer → advanceRehabDayFacet →
unparkAndSoftReentryFacet` is already pool-generic (`skillForPool`,
`gateTypeForTier`). A production warm-up term graduates via soft re-entry into
FSRS exactly like a leech: `state='review'`, `due = now + 24h`, softened
stability/difficulty. The production gate ladder
(`mc_cloze → production_cloze → production_cloze`) already exists.

### 5. `router/practice-router/practice-router.ts`

- `continueWarmupSession` handler: read the new optional `pool` from input,
  default `'recognition'`, pass through.
- `startWarmupSession` / `refreshWarmupSession` handlers: unchanged inputs (they
  now always do both pools internally).

## Contract (`packages/api-client`)

- `packages/api-client/src/orpc-contracts/practice-contract.ts`:
  - `continueWarmupSession` input: add optional `pool: 'recognition' |
    'production'` (default `recognition`). `start` / `refresh` inputs unchanged.
- `packages/api-client/src/orpc-contracts/common/flicktionary-schemas.ts` (the
  schemas live here, **not** in the contract file):
  - `PracticeDueSummaryEntrySchema` (`:500`): add
    `productionWarmupCount: z.number()`.
  - `StrengthenExerciseEntrySchema` (`:599`): add
    `pool: z.enum(['recognition', 'production'])`. The matching backend type
    `StrengthenExerciseEntry` (`apps/backend/src/service/practice/exercise-bank.ts:182`)
    gets the same field, populated where entries are built (both the `gate` and
    `bonus` tracks already run inside a known-`pool` `getStrengthenExercises`
    call, so the value is in scope — no extra lookup).
- Rebuild the api-client after the contract edit (`pnpm --filter
  @flicktionary/api-client build`) so the backend typecheck reads fresh `.d.ts`.

## Frontend (`apps/web/src`)

- `features/practice/components/exercise-session-view.tsx` — `mergePlaceholders`
  must key the `byTerm` map and lookup by **`(pool, userLookupId)`** instead of
  `userLookupId` alone (`:26,30`), so a both-skills term's recognition and
  production placeholders never overwrite each other during polling. Requires the
  new `pool` field on `StrengthenExerciseEntry`.
- `features/practice/api/practice-hooks.ts` — `useContinueWarmupSession` threads
  `pool` into the mutation input.
- `features/practice/components/warmup-continue-view.tsx` — read a `pool` search
  param (default `recognition`) and pass it to the continue hook + copy. Route
  `app/routes/.../practice/warmup-continue/$targetLanguage.tsx` search schema
  gains optional `pool`.
- `features/practice/components/practice-language-view.tsx` — add an **"N
  production terms warming up — continue"** affordance gated on
  `productionWarmupCount > 0`, opening warmup-continue with `pool=production`
  (alongside the existing recognition one). Follow `web-ui-patterns`.
- `features/practice/components/practice-landing-view.tsx` — fold
  `productionWarmupCount` into the per-language summary line.
- `features/review/components/session-vocabulary-view.tsx` — **no change**; the
  footer already calls `startWarmupSession`, which now parks both pools.

## Tests

- `service/practice/warmup.unit.test.ts`:
  - `startWarmupSession` parks both pools for the session's kept terms;
    production-only term gets a production ladder.
  - **Independent passes:** recognition hits `cap_reached` on term 1 while the
    production facet of term 2+ is **still parked** (the cap must not bleed into
    the production pass); `dailyLimitReached` true, production entries present.
  - production park never returns `cap_reached` / never sets `dailyLimitReached`.
  - mixed-queue serve (recognition + production exercises concatenated), and each
    entry carries the correct `pool`.
  - `continueWarmupSession({ pool: 'production' })` language-wide serve.
  - resume safety (re-enter parks nothing new, serves both pools).
- Due-summary: `productionWarmupCount` populated for onboarding production facets;
  `productionParkedCount` excludes `srs_state IS NULL`.
- Frontend: `mergePlaceholders` keeps recognition + production placeholders for
  one `userLookupId` distinct (a unit test over the merge helper).

## Deferred to PR time

- **Docs:** mark `docs/proposals/production-warmup.md` implemented (or fold the
  behavior into `SPEC.md` Practice/Strengthen + `docs/SRS.md` leech-rehab/warm-up
  sections) via the `create-pr` / `update-docs` flow.
- **Translations:** new Lingui strings (production warm-up affordance/copy) are
  English-only until `pnpm translate:sync` at PR time.

## Out of scope: form-facet production saves

This plan warms only the **citation** production facet, `(meaning_production,
'')`. A production-only *exact-form* save (`target_form != ''`) is **not**
warmed — and this exclusion is **intentional and forced**, not an oversight:

- The `practice_exercise` bank is keyed `(user_lookup_id, pool, status)` with
  **no `target_form` / facet identity** — this is Trap 19 (`leech-config.ts`).
  A form facet parked into the bank would collide with the citation facet on the
  same `(lookup, pool)`, so form facets **cannot** be represented in the bank at
  all today.
- For exactly this reason form facets also **never leech** (`isLeechableFacet`
  requires `target_form === ''`), and the **recognition** warm-up is likewise
  citation-only. So excluding form facets keeps production warm-up consistent
  with both existing surfaces.

Giving form facets a warm-up (or rehab) would require adding facet identity to
the exercise-bank key — the same prerequisite the pronunciation track needs
(see `pronunciation-warmup.md` → "fix Trap 19"). That is a separate, larger
piece of work; this plan deliberately does not take it on.

## Risks / watch-items

- **Day-one volume.** Both-skills terms double their warm-up exercise count on
  day one (the accepted tradeoff). If it feels heavy in testing, the gentler
  fallback is recognition-first parking with production deferred — but that was
  the rejected alternative, so treat it as a tuning escape hatch, not the design.
- **`listSessionKeptCitationFacets` generalization.** Adding a `skill` param
  touches an existing recognition caller — keep the default
  `'meaning_recognition'` so behavior is unchanged for it.
- **Production eligibility gate.** Only **enabled** (`disabled_at IS NULL`)
  production facets are parkable; a recognition+production term whose production
  was later disabled must not be parked into a production ladder.
