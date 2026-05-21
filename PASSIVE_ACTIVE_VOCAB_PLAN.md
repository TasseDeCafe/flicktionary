# Passive vs Active Vocabulary Plan

## Goal

Add a per-term learning mode so users can keep most vocabulary in the regular recognition pool while promoting a deliberate subset into an active drilling pool.

Active promotion is additive:

- Passive practice continues to include every kept, non-deleted term.
- Active practice includes only terms whose `learning_mode = 'active'`.
- Passive and active SRS state are independent.
- Active drill MVP reuses the existing generated-text practice experience. Production-oriented drills are v2.

## Key Decisions

- Store mode on `user_lookups`, the canonical vocabulary row.
- Keep existing `srs_*` columns as the passive SRS state. Do not rename them.
- Add a parallel `active_srs_*` column set for active practice.
- Add `practice_sessions.pool = 'passive' | 'active'` so rating knows which SRS state to update.
- Make the active-session uniqueness rule per pool: one active passive session and one active drill can coexist for the same language.
- Do not let active drills consume passive daily-new allowance. `added_to_practice_at` stays passive-only unless a future migration explicitly splits timestamps.
- Follow repo migration workflow: create a new migration through Supabase CLI, verify with dev-tunnel reset, then regenerate DB types.

## Data Model

Create a new append-only migration from `apps/backend/supabase/supabase-dev-tunnel/`:

```bash
doppler run -- supabase migration new passive_active_vocabulary
```

Migration contents:

```sql
ALTER TABLE public.user_lookups
  ADD COLUMN learning_mode TEXT NOT NULL DEFAULT 'passive'
    CHECK (learning_mode IN ('passive', 'active')),
  ADD COLUMN active_srs_state public.srs_state NULL,
  ADD COLUMN active_srs_due TIMESTAMP WITH TIME ZONE NULL,
  ADD COLUMN active_srs_stability REAL NULL,
  ADD COLUMN active_srs_difficulty REAL NULL,
  ADD COLUMN active_srs_last_review TIMESTAMP WITH TIME ZONE NULL,
  ADD COLUMN active_srs_reps INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN active_srs_lapses INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_user_lookups_active_due
  ON public.user_lookups (user_id, target_language, active_srs_due)
  WHERE learning_mode = 'active'
    AND active_srs_state IS NOT NULL
    AND deleted_at IS NULL;

CREATE INDEX idx_user_lookups_active_due_sort
  ON public.user_lookups (user_id, target_language, active_srs_due ASC NULLS LAST, id)
  WHERE learning_mode = 'active'
    AND deleted_at IS NULL;

ALTER TABLE public.practice_sessions
  ADD COLUMN pool TEXT NOT NULL DEFAULT 'passive'
    CHECK (pool IN ('passive', 'active'));

ALTER TABLE public.practice_ratings
  ADD COLUMN pool TEXT NOT NULL DEFAULT 'passive'
    CHECK (pool IN ('passive', 'active'));

DROP INDEX public.one_active_practice_session_per_user_lang;

CREATE UNIQUE INDEX one_active_practice_session_per_user_lang_pool
  ON public.practice_sessions (user_id, target_language, pool)
  WHERE status = 'active';
```

Verify with:

```bash
doppler run -- supabase db reset --local
```

Then regenerate DB types from `apps/backend/supabase/supabase-dev-tunnel/`:

```bash
doppler run -- supabase gen types typescript --local > /Users/sebastien/Documents/flicktionary/apps/backend/src/transport/database/database.public.types.ts
doppler run -- supabase gen types typescript --local --schema auth > /Users/sebastien/Documents/flicktionary/apps/backend/src/transport/database/database.auth.types.ts
```

## Backend

### User Lookups Repository

Keep current `srs_*` fields as passive state.

Add:

- `LearningMode = 'passive' | 'active'`
- `PracticePool = 'passive' | 'active'`
- `setLearningMode({ userLookupId, userId, learningMode })`
- `applyFsrsResultForPool({ userLookupId, pool, result })`
- `initializeSrsStateForPool({ userLookupId, pool })`

Rules:

- Passive initialization writes `srs_state`, `srs_due`, and `added_to_practice_at`.
- Active initialization writes only `active_srs_state` and `active_srs_due`. It must not write `added_to_practice_at`.
- Demoting active to passive preserves `active_srs_*`.
- Re-promoting resumes existing active SRS state.

Extend existing methods:

- `findByKey` and `findByIdForUser` return active SRS fields and `learning_mode`.
- `listDueSummary` computes passive and active counts in one query.
- `listChunksForLanguage` accepts optional `learningMode` filter.
- `ChunkRow` and `ChunkSchema` expose `learningMode`.

Due summary additions:

- `activeTotal`
- `activeReviewDueCount`
- `activeLearningDueCount`
- `activeNewCount`
- `activePracticeSessionId`

Existing passive fields keep their names:

- `totalKept`
- `reviewDueCount`
- `learningDueCount`
- `newCount`
- `activePracticeSessionId` should be renamed to `passivePracticeSessionId` to avoid ambiguity, or keep a deprecated alias only if needed temporarily.

### Practice Sessions Repository

This is the most important implementation point. The current membership snapshot is created in `practice-sessions-repository.ts`, not in `start-practice-session.ts`.

Update `insertOrResume` to accept:

```ts
pool: 'passive' | 'active'
```

Insert:

```sql
INSERT INTO public.practice_sessions
  (user_id, target_language, pool, max_new_terms, max_review_terms)
```

Conflict target:

```sql
ON CONFLICT (user_id, target_language, pool) WHERE status = 'active' DO NOTHING
```

Existing-session lookup must include `pool`.

Snapshot SQL:

- Passive pool:
  - no `learning_mode` filter
  - review terms use `srs_state`, `srs_due`
  - new terms use `srs_state IS NULL`
  - daily new cap applies
- Active pool:
  - filter `learning_mode = 'active'`
  - review terms use `active_srs_state`, `active_srs_due`
  - new terms use `active_srs_state IS NULL`
  - no daily new cap

Also update:

- `findActiveForUser({ userId, targetLanguage, pool })`
- `abandonStaleForUser({ userId, targetLanguage, pool, olderThanHours })`
- comments that mention `one_active_practice_session_per_user_lang`

### Practice Services

`start-practice-session.ts`:

- Add mode `'active_drill'`.
- Map mode to pool:
  - `active_drill` -> `active`
  - all existing modes -> `passive`
- Use active counts when validating `active_drill`.
- For active drill:
  - max new terms = all active-new terms
  - max review terms = all active due/learning terms
  - no passive daily-new cap
- Resume only an active session in the same pool.

`generate-next-practice-text.ts`:

- Read session pool from `practice_sessions`.
- Use pool-aware SRS fields when sorting remaining rows.
- Initialize new rows through `initializeSrsStateForPool`.
- Stubborn-again logic can stay keyed by `user_lookup_id`, but should be constrained by the session pool through the session's ratings and snapshot.

`rate-chunk.ts`:

- Read `practice_session.pool`.
- Apply FSRS with `applyRating(row, rating, now, pool)`.
- Persist with `applyFsrsResultForPool`.
- Insert `practice_ratings.pool`.

`fsrs.ts`:

- Add a pool argument to the mapper.
- Passive pool reads `srs_*`.
- Active pool reads `active_srs_*`.
- Null state in either pool seeds `createEmptyCard(now)`.

### Card Status Service

Extend `setCardStatus` and `setCardStatusBatch` with optional:

```ts
learningMode?: 'passive' | 'active'
```

Important same-status rule:

- If card is already `kept` and caller supplies `learningMode`, update `user_lookups.learning_mode` even if status is unchanged.
- This matters because highlights are kept by default, and "Keep as active" on an already-kept highlight must not no-op.

Keep transitions:

- First keep defaults to passive.
- First keep with `learningMode` stamps that mode.
- Existing kept row preserves current mode unless the caller explicitly changes it.

### Contracts

`common/flicktionary-schemas.ts`:

- Add `LearningModeSchema = z.enum(['passive', 'active'])`.
- Add `PracticePoolSchema = z.enum(['passive', 'active'])`.
- `ChunkSchema.learningMode`
- `ChunkRowSchema.learningMode`
- `PracticeSessionSchema.pool`
- `PracticeDueSummaryEntrySchema` active counts and pool-specific session ids.

`practice-contract.ts`:

- Add `'active_drill'` to `PracticeSessionModeSchema`.

`cards-contract.ts`:

- `updateStatus.input.learningMode?`
- `updateStatusBatch.input.learningMode?`

`chunks-contract.ts`:

- `setLearningMode`
- `listChunks.input.learningMode?`

### Routers

`chunks-router.ts`:

- Add `setLearningMode`.
- Verify ownership with `findByIdForUser`.
- Return updated `ChunkSchema` or `ChunkRowSchema`, matching existing route style.

`cards-router.ts`:

- Forward optional `learningMode`.

`practice-router.ts`:

- Return pool-specific summary fields.
- Ensure `toPracticeSessionDto` includes `pool`.

## Frontend

### Triage List

In `triage-row.tsx`:

- Replace single keep control with split control:
  - primary keep button keeps as passive
  - chevron opens menu with `Keep as passive` and `Keep as active`
- Use Lingui for all strings.
- Use lucide `Star` for active state rather than a raw glyph.
- If a row is already kept-active, show compact active indicator.

Bulk actions:

- `Keep all` keeps as passive.
- Do not add `Keep all as active`.

### Focus View

For normal triage focus:

- Keep/reject header buttons stay.
- Add `Learning mode` row inside the card section when `card.status === 'kept'`.
- Use two controls: `Passive`, `Active`.
- Mutation calls `chunks.setLearningMode`.

For `from='vocabulary'` and `from='practice'`:

- Route support already exists.
- Add two stacked full-width buttons near the bottom of the scroll body:
  - `Add to active vocabulary`
  - `Add to passive vocabulary`
- Each button calls `setLearningMode`, then returns to origin:
  - vocabulary -> `/vocabulary`
  - practice -> `/practice/$practiceSessionId`
- No `learning_mode_set_at` column for v1.

### Vocabulary

`vocabulary-list-view.tsx`:

- Add filter pills: `All`, `Passive`, `Active`.
- Sync with URL search param `mode=passive|active`; absent means all.
- Thread `learningMode` into `useListChunksInfinite`.

`vocabulary-row.tsx`:

- Show compact `Active` chip with `Star` when `chunk.learningMode === 'active'`.

`vocabulary-action-drawer.tsx`:

- Add `Switch to active vocabulary` or `Switch to passive vocabulary`.
- Call `setLearningMode`.
- Invalidate practice due summary and chunk list caches.

### Practice Landing

`practice-landing-view.tsx`:

- Existing summary line remains passive-oriented.
- Append active count when `activeTotal > 0`, for example `3 active`.

### Practice Language Screen

Split the page into two action sections.

Section 1: `Vocabulary`

- Existing passive actions:
  - Continue session
  - Review follow-ups
  - Learn new terms
  - Learn more anyway
  - End session
- Uses passive session id and passive counts.

Section 2: `Active vocabulary`

- Shown only when `activeTotal > 0`.
- Actions:
  - Continue active drill, when active pool session exists
  - End active drill
  - Drill active terms, when active due/new count is positive
- Disabled/quiet state when active terms exist but none are currently due/new.

The `/practice/start` route search schema must accept `mode: 'active_drill'`.

### Hooks and Cache

`vocabulary-hooks.ts`:

- Add `useSetLearningMode`.
- Optimistically update `learningMode` in all `chunks.listChunks` pages.
- Invalidate `practice.dueSummary` on settle.

`review-hooks.ts`:

- Extend `useUpdateCardStatus` input with `learningMode`.
- Optimistically patch card chunk `learningMode`.

`practice-hooks.ts`:

- Extend mode type support.
- Ensure `startSession` cache seed includes `pool`.

Follow the repo's oRPC query-key rule:

- use `.key(...)` for invalidation/cancel
- use `.queryKey({ input })` for exact `setQueryData` and `getQueryData`

## Lingui Strings

Add via `useLingui().t`:

- `Keep as passive`
- `Keep as active`
- `Learning mode`
- `Passive`
- `Active`
- `Add to active vocabulary`
- `Add to passive vocabulary`
- `All`
- `Switch to active vocabulary`
- `Switch to passive vocabulary`
- `Active vocabulary`
- `Drill active terms`
- `Continue active drill`
- `End active drill`

User-facing strings should say `term`, not `chunk`.

## SPEC.md Updates

Update:

- Data model `user_lookup` with `learning_mode` and `active_srs_*`.
- Practice section with active drill behavior.
- Vocabulary section with mode filter and switch action.
- Review section with split keep control and focus mode picker.
- v2/out-of-scope with production-oriented active drills.

Also update the existing data model wording so `srs_*` is explicitly passive SRS without renaming it.

## Verification

Run:

```bash
pnpm check:types
pnpm lint
```

Manual golden path:

1. Apply migration with dev-tunnel reset and confirm new columns/indexes.
2. Triage row `Keep as active` stores `learning_mode = 'active'`.
3. Plain keep and `Keep all` store/pass through passive behavior.
4. Already-kept highlight can still be switched to active through the split keep or focus control.
5. Focus-view mode row persists passive/active flips.
6. Add-a-word flow shows active/passive buttons and returns to Vocabulary.
7. Practice save-unannotated flow shows active/passive buttons and returns to the practice session.
8. Vocabulary `All / Passive / Active` filters work and URL state survives reload.
9. Vocabulary drawer can switch modes in both directions.
10. Active terms still appear in normal passive practice when their passive SRS is due.
11. Active drill snapshots only `learning_mode = 'active'` rows.
12. Rating in active drill advances only `active_srs_*`.
13. Rating in passive practice advances only `srs_*`.
14. Starting passive and active sessions in the same language can produce two active `practice_sessions` rows with different `pool` values.
15. Starting a second session in the same language and same pool resumes the existing one.
16. Active drill initialization does not change `added_to_practice_at` and does not reduce passive daily-new allowance.

## Audit Greps

Before considering the work done:

```bash
rg -n "active_srs|learning_mode|pool" apps/backend/src apps/web/src packages/api-client/src SPEC.md
rg -n "srs_state|srs_due|srs_stability|srs_difficulty|srs_last_review|srs_reps|srs_lapses" apps/backend/src apps/web/src packages/api-client/src
```

Expected result:

- `srs_*` references are passive practice paths.
- `active_srs_*` references are active practice paths.
- `practice_sessions.pool` is used for start, resume, rate, summarize, and UI continue/end behavior.
