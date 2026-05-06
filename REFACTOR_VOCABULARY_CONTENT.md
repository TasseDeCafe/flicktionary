# Refactor: Promote vocabulary content fields from `cards` to `user_lookups`

## Context

The five content fields — `translation`, `definition`, `target_example`, `native_example`, `exploration_extras` — currently live on `cards`. The same chunk highlighted in N sessions creates N cards with N independent copies. Editing one doesn't propagate to siblings; renaming a `headword` silently leaves stale `user_lookups` rows; the planned Manage Chunks view would always read only `first_card_id`'s values.

This refactor makes `user_lookups` the canonical home of vocabulary content. Cards become per-session events (segment, surface_form, status, chat) joined to a single chunk row. It also unblocks the upcoming Manage Chunks feature (see `MANAGE_CHUNKS_PLAN.md`).

## Goal

- One row per `(user_id, target_language, headword, sense)` carries canonical content.
- Editing translation/headword/etc. propagates to all sibling cards via JOIN.
- Headword renames are atomic single UPDATEs.
- Cards reference `user_lookups` by UUID FK; the composite PK is replaced by a UUID PK.

## Schema changes

**Modify in place** (project convention is reset, not new migration): `apps/backend/supabase/migrations/20260425215345_initial_schema.sql`. The file is also duplicated at `apps/backend/supabase/supabase-dev-tunnel/supabase/migrations/...` — confirm whether it's a build mirror or hand-maintained, edit both if needed.

### `user_lookups`
- New PK: `id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4()`.
- Replace composite-PK constraint with `UNIQUE (user_id, target_language, headword, sense)`.
- Add content columns: `translation TEXT NULL`, `definition TEXT NULL`, `target_example TEXT NULL`, `native_example TEXT NULL`, `exploration_extras JSONB NOT NULL DEFAULT '{}'::jsonb`.
- Keep `first_card_id` (set on first card insertion, never updated; powers Phase 2's "Open source" navigation).
- All existing SRS columns and indexes stay.

### `cards`
- Add `user_lookup_id UUID NOT NULL REFERENCES public.user_lookups(id) ON DELETE RESTRICT`.
- Drop `headword`, `sense`, `translation`, `definition`, `target_example`, `native_example`, `exploration_extras`.
- Add `idx_cards_user_lookup_id ON cards(user_lookup_id)`.
- Existing indexes (`idx_cards_study_session_status`, `idx_cards_highlight_id`) unchanged.

`card_chat_messages` and other tables are unaffected.

## Backend changes

### `apps/backend/src/transport/database/user-lookups/user-lookups-repository.ts`

New methods:

- `findOrCreate({ userId, targetLanguage, headword, sense })` → returns the row.
  ```sql
  INSERT INTO user_lookups (user_id, target_language, headword, sense)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (user_id, target_language, headword, sense) DO UPDATE
    SET headword = EXCLUDED.headword
  RETURNING *;
  ```
  The no-op `DO UPDATE` lets `RETURNING` give us the existing row's id.

- `updateContent({ id, translation?, definition?, targetExample?, nativeExample?, explorationExtrasPatch? })` — partial update; nullable patches use `COALESCE($1, translation)` so an explicit null clears, but undefined preserves. For `exploration_extras` MERGE: `extras = extras || $patch` when patch is non-null.

- `renameKey({ id, headword, sense })` — single UPDATE. UNIQUE-constraint violation surfaces a typed error (`'CONFLICT'`) the caller maps to a 409.

Adapted methods:

- `upsertOnKeep` and `upsertOnExport` no longer create the row. They UPDATE counters/timestamps. The user_lookups row is guaranteed to exist (created at card-insert time).
- All read methods (`listVocabularyForLanguage`, `listEligibleForLanguage`, `findByKey`, `listDueSummary`, `listHeadwordSensesForLanguage`) now read content directly from `user_lookups` — no card join needed for content.

### `apps/backend/src/transport/database/cards/cards-repository.ts`

- `insertCard` parameters: drop `headword`, `sense`, and the 5 content fields. Add `userLookupId`.
- `updateFields` patch: card-level updates only (`status`, `surface_form`, `highlight_id`). Content/headword routes go through `userLookupsRepository`.
- All SELECTs that need content gain `JOIN public.user_lookups ul ON ul.id = c.user_lookup_id`. DTO mapping returns a nested `chunk: { id, headword, sense, translation, definition, targetExample, nativeExample, explorationExtras }`.

### Service layer

- **`apps/backend/src/service/processing/process-session.ts`**: for each chunk from `basicDataPass`:
  1. `userLookupsRepository.findOrCreate({ userId, targetLanguage, headword, sense })` → `{ id }`.
  2. `userLookupsRepository.updateContent({ id, translation, definition, targetExample, nativeExample })` (only setting non-null fields; preserves prior content if reprocessed).
  3. `cardsRepository.insertCard({ studySessionId, segmentId, highlightId, userLookupId: id, surfaceForm })`.
  Wrap in a transaction per session.

- **`apps/backend/src/service/exploration/explore-card-if-missing.ts`**: writes from `enrichmentPass` go to `userLookupsRepository.updateContent(card.user_lookup_id, ...)`. The "skip if already enriched" check reads `exploration_extras` from user_lookups.

- **`apps/backend/src/service/cards/set-card-status.ts`**: drop the user_lookups insert; just call adapted `upsertOnKeep`/`upsertOnExport` to bump counters.

- **`apps/backend/src/service/export/build-csv.ts`**: read content from the joined user_lookups row.

- **`apps/backend/src/transport/third-party/anthropic/passes/generate-practice-text.ts`** (`fetchChunkContent`): read content directly from user_lookups.

### oRPC contracts — `packages/api-client/src/orpc-contracts/`

- `common/flicktionary-schemas.ts`: introduce `ChunkSchema` (id, userId, targetLanguage, headword, sense, translation, definition, targetExample, nativeExample, explorationExtras, srsState, srsDue, count, …). Refactor `CardSchema` to drop the 5 content fields and `headword/sense`; add `userLookupId` and an embedded `chunk: ChunkSchema` for list responses.
- `cards-contract.ts`: `updateFields` input loses content fields and `headword/sense`. Get/list responses return `{ ...card, chunk: ChunkSchema }`.
- New `chunks-contract.ts`:
  - `updateChunkContent({ id, translation?, definition?, targetExample?, nativeExample?, explorationExtras? })`
  - `renameChunk({ id, headword?, sense? })` — 409 on UNIQUE conflict.
- Register the new contract in `root-contract.ts`.

## Frontend changes

- **`apps/web/src/features/review/components/editable-card-fields.tsx`**: bind translation/definition/examples to `chunks.updateChunkContent({ id: card.chunk.id, ... })`. Bind headword/sense to `chunks.renameChunk`. On 409 show a toast.
- **`apps/web/src/features/review/components/focus-view.tsx`**: hook returns `card + chunk`; UI reads `card.chunk.translation` etc.
- **`apps/web/src/features/review/components/triage-row.tsx`**: `getBackPreview` reads `card.chunk.translation || card.chunk.definition`. Headword reads from `card.chunk.headword`.
- **`apps/web/src/features/review/components/full-exploration-renderer.tsx`**: reads from `chunk.exploration_extras` and other chunk fields.
- **`apps/web/src/features/practice/components/{practice-session-view,rate-sheet}.tsx`**: the existing "fetch chunk content" TODO becomes trivially fixable post-refactor — out of scope for the refactor itself but unblocked by it.

## Pitfalls / decisions

- **Headword/sense rename collision**: 409 + toast. **No silent merge** in v1. Future "merge chunks" UX is a separate feature.
- **Card creation race**: `INSERT … ON CONFLICT DO UPDATE` makes `findOrCreate` atomic.
- **`first_card_id`** is now purely historical. Set on first card insert, never updated.
- **`count` semantic** unchanged. Still increments on `kept`/`exported` transitions.
- **No data migration concern**: project resets DB on schema changes.
- **`exploration_extras` write path**: must MERGE JSONB (`extras = extras || $patch`), not overwrite, so subsequent partial enrichments don't clobber prior keys.
- **Phase 10 shelved**: no automated integration tests; rely on manual end-to-end (per project memory).

## Verification

DB reset:
```
cd apps/backend/supabase/supabase-dev-tunnel && npx supabase db reset
```
(check `apps/backend/package.json` for the actual `db:reset` script.)

Manual end-to-end:
1. Sign in, run a session that produces ≥3 cards. Confirm cards carry `user_lookup_id`; user_lookups carry the content fields.
2. Triage view — preview text and headwords still render correctly.
3. Focus view: edit a translation → open a sibling card with the same chunk → confirm change is visible.
4. Rename a headword → all sibling cards reflect immediately.
5. Try renaming to collide with an existing chunk → 409 toast, no merge.
6. "Generate full exploration" → confirm enrichment writes to user_lookups; `exploration_extras` is merged, not replaced.
7. Export to CSV → content fields populate correctly.
8. Practice session → chunk content surfaces in the rate sheet.
9. `pnpm typecheck` (or equivalent) → clean.
10. Confirm migration mirror behavior (one or both files edited consistently).

## Critical files

- `apps/backend/supabase/migrations/20260425215345_initial_schema.sql` (and mirror)
- `apps/backend/src/transport/database/cards/cards-repository.ts`
- `apps/backend/src/transport/database/user-lookups/user-lookups-repository.ts`
- `apps/backend/src/service/processing/process-session.ts`
- `apps/backend/src/service/exploration/explore-card-if-missing.ts`
- `apps/backend/src/service/cards/set-card-status.ts`
- `apps/backend/src/service/export/build-csv.ts`
- `apps/backend/src/transport/third-party/anthropic/passes/generate-practice-text.ts`
- `apps/backend/src/router/cards-router/cards-router.ts`
- `packages/api-client/src/orpc-contracts/cards-contract.ts`
- `packages/api-client/src/orpc-contracts/chunks-contract.ts` (new)
- `packages/api-client/src/orpc-contracts/root-contract.ts`
- `packages/api-client/src/orpc-contracts/common/flicktionary-schemas.ts`
- `apps/web/src/features/review/components/editable-card-fields.tsx`
- `apps/web/src/features/review/components/focus-view.tsx`
- `apps/web/src/features/review/components/triage-row.tsx`
- `apps/web/src/features/review/components/full-exploration-renderer.tsx`
- `apps/web/src/features/review/api/review-hooks.ts`
