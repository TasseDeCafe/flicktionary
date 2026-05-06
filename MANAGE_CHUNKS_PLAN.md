# Manage Chunks (Vocabulary tab) — Deferred Feature Plan

> **Status**: deferred. Depends on `REFACTOR_VOCABULARY_CONTENT.md` having landed.
> Pick this up after the refactor is verified.

## Context

Today the only way to edit saved chunks is in-flow during triage (per session) or focus view (per card). There's no cross-session "browse my vocabulary" surface. The SPEC anticipates this as a v2 feature.

This plan adds a new top-level **Vocabulary** tab listing every kept chunk for a target language, sortable by recency or SRS due date, with mobile-native row actions (edit, open source, soft-delete) via a tap-to-open bottom drawer. Editing reuses the existing focus view modal by routing to the chunk's representative card. Soft-deleted chunks are hidden everywhere — including the SRS/Practice queue. No suspend/bury, no SRS-modifying actions in v1.

## Locked decisions

1. **Tab placement**: 4th top-level tab on bottom bar + sidebar. Route: `/vocabulary`.
2. **Soft-delete**: add `deleted_at TIMESTAMPTZ` to `user_lookups`. Hide from this view *and* Practice/SRS. No Trash/restore UI in v1.
3. **Edit flow**: tap row → drawer → "Edit" navigates to `/sessions/$sessionId/review/$cardId` (existing focus view; post-refactor reads chunk content from user_lookups via JOIN).
4. **Virtualization**: `@tanstack/react-virtual` only (no react-table). Mobile row list, not a desktop grid.
5. **Row actions on mobile**: vaul drawer (modeled on `RateSheet`) with `Edit | Open source | Delete`.
6. **Sort options**: "Recently added" (default — `user_lookups.created_at DESC`) and "Due soonest" (`srs_due ASC NULLS LAST`).
7. **Filter**: target-language switcher.

## Schema additions (atop the refactor)

```sql
-- Add to public.user_lookups (refactor already gave us the UUID PK).
created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
deleted_at TIMESTAMP WITH TIME ZONE NULL,
```

Replace existing indexes with deleted-aware partial variants and add two sort indexes:

```sql
CREATE INDEX idx_user_lookups_user_target
  ON public.user_lookups (user_id, target_language)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_user_lookups_due
  ON public.user_lookups (user_id, target_language, srs_due)
  WHERE srs_state IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_user_lookups_recent
  ON public.user_lookups (user_id, target_language, created_at DESC, id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_user_lookups_due_sort
  ON public.user_lookups (user_id, target_language, srs_due ASC NULLS LAST, id)
  WHERE deleted_at IS NULL;
```

The UUID `id` (from the refactor) gives us a stable cursor tiebreaker.

## Backend additions

### `apps/backend/src/transport/database/user-lookups/user-lookups-repository.ts`

- All existing read methods get `WHERE deleted_at IS NULL`.
- `upsertOnKeep` / `upsertOnExport` clear `deleted_at` on conflict (re-keeping a deleted chunk revives it).
- New methods:
  ```ts
  type ChunksSort = 'recent' | 'due'
  type ChunksCursor =
    | { sort: 'recent'; createdAt: string; id: string }
    | { sort: 'due'; phase: 'scheduled' | 'unscheduled'; srsDue: string | null; id: string }

  listChunksForLanguage(params: {
    userId: string
    targetLanguage: string
    sort: ChunksSort
    cursor: ChunksCursor | null
    limit: number          // 50 default
  }): Promise<{ rows: ChunkRow[]; nextCursor: ChunksCursor | null }>

  softDeleteChunk(id: string, userId: string): Promise<void>
  listLanguagesForUser(userId: string): Promise<string[]>
  ```

`ChunkRow` denormalizes `firstCardId` and the originating `studySessionId` (LEFT JOIN cards on `first_card_id`) so the frontend can navigate to focus view and to the source without round trips.

Cursor design:
- `recent` — `ORDER BY created_at DESC, id ASC`. Cursor: `(created_at, id) < ($cursor)`.
- `due` — two-phase to handle NULLS LAST. Phase 1: `srs_due IS NOT NULL` ordered `srs_due ASC, id ASC`. Phase 2: `srs_due IS NULL` ordered `id ASC`. Encode `phase` in the cursor.

### oRPC contract (extends `chunks-contract.ts` from the refactor)

- `GET /chunks` (`listChunks`) — input `{ targetLanguage, sort, cursor?, limit? }`, output `{ rows, nextCursor }`. `cursor` wire format: base64 JSON.
- `GET /chunks/languages` — output `{ languages }`.
- `POST /chunks/delete` (body: `{ id }`) — soft delete. POST avoids URL-encoding pain even though `id` is now a UUID; consistent with other mutations.

### Router

- New file: `apps/backend/src/router/chunks-router/chunks-router.ts`. Thin: calls the repo directly, no service layer (no orchestration beyond a single UPDATE for soft-delete).

## Frontend additions

### Install

`@tanstack/react-virtual` on `apps/web` (or via the workspace catalog if used).

### Route

- `apps/web/src/app/routes/_authenticated/_app/vocabulary/index.tsx` — URL `/vocabulary`.

### Components — `apps/web/src/features/vocabulary/components/`

- `vocabulary-list-view.tsx` — orchestrator: language switcher, sort dropdown, virtualizer, infinite query.
- `vocabulary-row.tsx` — bold headword + muted sense subtitle + 1-line translation/definition preview + due chip + count badge.
- `vocabulary-action-drawer.tsx` — vaul drawer mirroring `RateSheet` patterns. Items: `Edit | Open source | Delete` (Delete shows a confirm step).
- `vocabulary-language-switcher.tsx` — pills/select fed by `chunks.listLanguages`.
- `vocabulary-empty-state.tsx`.

### Data hook

- `apps/web/src/features/vocabulary/api/vocabulary-hooks.ts`:
  - `useInfiniteQuery` over `chunks.listChunks`. `getNextPageParam: (last) => last.nextCursor`. Confirm whether `@orpc/tanstack-query` exposes `infiniteOptions`; otherwise wire `useInfiniteQuery` manually with a `queryFn`.
  - `useDeleteChunk` mutation; on success invalidate `chunks.listChunks` (across language/sort permutations) + `practice.dueSummary`.

### Virtualizer

```tsx
const rowVirtualizer = useVirtualizer({
  count: hasNextPage ? rows.length + 1 : rows.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 72,
  overscan: 8,
})
// fetchNextPage when last visible index >= rows.length - 1
```

### Wiring

- "Edit" → navigate to `/sessions/${row.studySessionId}/review/${row.firstCardId}`.
- "Open source" → navigate to `/sessions/${row.studySessionId}`.
- "Delete" → `useDeleteChunk` with optimistic cache removal.

### Tab bar / sidebar

- `apps/web/src/features/navigation/components/bottom-tab-bar.tsx`:
  - Widen the `to` literal-union on `TabConfig` to include `'/vocabulary'`.
  - Add `{ to: '/vocabulary', label: t\`Vocabulary\`, icon: BookOpen, matchPrefixes: ['/vocabulary'] }`.
  - Update JSX: `tabs[0], tabs[1], FAB, tabs[2], tabs[3]`. Verify visual balance at iPhone-SE width.
- `apps/web/src/features/navigation/components/sidebar-nav.tsx`: add the same entry.

### i18n

All strings via `useLingui()` + ``t`...` `` macro. Update Lingui catalogs.

## Pitfalls

- **Cursor stability under SRS writes** — rating mutates `srs_due`; UUID tiebreaker (`id`) makes the cursor stable enough; accept eventual consistency on long scrolls.
- **NULLS LAST + index plan** — handled by the two-phase cursor.
- **oRPC infinite query helper** — verify `@orpc/tanstack-query` exposes `infiniteOptions` first; else wire `useInfiniteQuery` manually.
- **Variable row heights** — line-clamp the preview to 1 line, or use `measureElement` if we keep variable heights.
- **Cache invalidation after delete** — invalidate the entire infinite-query family; surgical patching is fragile across language/sort permutations.
- **`upsertOnKeep` revives a soft-deleted chunk** — must clear `deleted_at` in `ON CONFLICT DO UPDATE`.
- **Bottom-bar layout with 4 tabs + FAB** — verify at iPhone-SE width; don't naively `flex-1` over five children, render two-left + FAB + two-right.

## Verification

DB reset → run a session → keep chunks across two target languages.

1. Open `/vocabulary` — list shows kept chunks for the default language, sort = Recently added.
2. Switch language pill → list refetches. Switch sort to "Due soonest" → order changes.
3. Force a small page size in dev (5) → scroll past page boundary → next page loads, no duplicates, no skips.
4. Tap a row (mobile) → drawer with `Edit | Open source | Delete`.
5. Tap Edit → focus view opens; edit translation; back navigates to `/vocabulary` with updated preview.
6. Tap Open source → land on `/sessions/$sessionId`.
7. Tap Delete → row vanishes optimistically; refresh page → still gone.
8. Open `/practice` → start a session → confirm deleted chunk is NOT in any generated text and NOT counted in due summary.
9. Re-keep the same headword in a new session → chunk reappears in `/vocabulary` (revival via `upsertOnKeep` clearing `deleted_at`).
10. `EXPLAIN ANALYZE` the list query for both sorts — confirm `idx_user_lookups_recent` / `idx_user_lookups_due_sort` are used.
11. Mobile bottom bar lays out correctly with 4 tabs + FAB at iPhone-SE width.
