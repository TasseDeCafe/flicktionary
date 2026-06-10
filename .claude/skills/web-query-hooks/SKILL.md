---
name: web-query-hooks
description: Conventions for writing or editing TanStack Query hooks in apps/web (features/*/api/*-hooks.ts) — declarative invalidation via meta.invalidates, the optimistic-update helper, error/success meta flags, and oRPC key conventions. Use whenever creating or modifying a useQuery/useMutation hook in the web app.
---

Conventions for TanStack Query hooks in `apps/web`. Follow these instead of inventing per-hook plumbing — the cross-cutting behavior (invalidation, toasts, Sentry) is handled centrally in `apps/web/src/config/react-query-config.ts`.

## Where hooks live

One file per feature: `apps/web/src/features/<feature>/api/<feature>-hooks.ts`. Hooks call `orpcQuery` (from `@/lib/transport/orpc-client`) and pass options built ONLY via `.queryOptions()` / `.mutationOptions()` / `.infiniteOptions()`. All user-facing strings in `meta` use `useLingui()`'s `` t`...` `` macro.

## Cache invalidation: meta.invalidates

A mutation declares the query keys it affects; a central MutationCache handler invalidates them when the mutation settles. Do NOT write `useQueryClient()` + `onSuccess: () => queryClient.invalidateQueries(...)` for plain invalidation.

```ts
export const useCreateStudySession = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.studySessions.create.mutationOptions({
      meta: {
        invalidates: [orpcQuery.studySessions.list.key()],
        errorMessage: t`Failed to create session`,
        showErrorModal: true,
      },
    })
  )
}
```

Rules:

- Keys may close over **hook parameters** (`useRetryEnrichment(sessionId)` can use `key({ input: { sessionId } })`) but NEVER **mutation variables** — `meta` is fixed when `mutationOptions()` is evaluated at render, long before `.mutate(vars)` runs. If a key depends on mutation variables, fall back to an explicit `onSuccess`/`onSettled` callback.
- Invalidation fires on settle (success AND error, after any rollback) and is fire-and-forget. If you need success-only side effects (e.g. writing the response into the cache with `setQueryData`), keep an explicit callback for that part — see `useUpdateCardStatus` in `features/review/api/review-hooks.ts`.
- Conditional keys are built inline: `invalidates: [...(sessionId ? [getSessionCardsKey(sessionId)] : []), orpcQuery.cards.get.key()]`.

## WARNING: `invalidates` means something different in apps/native

The native app invalidates ALL queries after every mutation by default; there `invalidates: []` is an opt-OUT, and the type is `string[]`. In web, `invalidates` is an explicit allow-list of `QueryKey`s and omitting it invalidates nothing. Never copy the idiom between apps — the types collide (string[] vs array-of-arrays), and a compile error there means you imported the wrong app's semantics: fix the semantics, not the types.

## Error/success meta flags

Handled centrally in `react-query-config.ts` — never hand-roll toasts, error overlays, or Sentry logging inside a hook:

- `errorMessage` — toast text on failure. `showErrorToast` defaults to true.
- `showErrorModal` — opens the intrusive error overlay instead of a toast (default false for generic errors).
- `showSuccessToast` + `successMessage` — opt-in success toast (fires in onMutate, i.e. optimistically).
- `showErrorToast: false` — suppress the global toast when the component handles errors itself (see `useCreateAdhocCard`).

## Optimistic updates

Use the helpers in `@/lib/query/optimistic`: `onMutate` returns `applyOptimistic(queryClient, [optimisticPatch<CacheShape>(key, updater), ...])`, `onError` calls `context?.rollback()`, and the settle-time refetch comes from `meta.invalidates` — that pairing makes the server's view the truth after success or rollback.

```ts
onMutate: ({ id }) =>
  applyOptimistic(queryClient, [
    optimisticPatch<{ pages: Array<{ rows: Array<{ id: string }> }> }>(orpcQuery.chunks.listChunks.key(), (old) =>
      patchInfinitePages(old, (rows) => rows.filter((row) => row.id !== id))
    ),
  ]),
onError: (_err, _vars, context) => context?.rollback(),
```

- `patchInfinitePages` is for cursor-paginated infinite caches (`{ pages: [{ rows, nextCursor }] }`).
- When a domain has real cache-shape logic or several cooperating caches, put pure updaters in a feature cache module and compose them: see `features/review/api/card-cache.ts` and `features/vocabulary/api/facet-cache.ts`.
- `useUpdateReadingProgress` (sessions-hooks.ts) is the sanctioned exception: a monotonic patch with no rollback and deliberately NO invalidation — read its comment before touching it.

## oRPC key conventions

- `.key()` — prefix key for a whole endpoint family; matches every input. Use for invalidation filters and `setQueriesData`.
- `.key({ input: {...} })` — prefix key scoped to an input subset.
- `.queryKey({ input: {...} })` — exact key; required for `getQueryData`/`setQueryData` (which do exact matching).

## Gotcha: contract edits need an api-client rebuild

The backend/web consume `@flicktionary/api-client` through built `.d.ts` files (TS project refs). After editing anything under `packages/api-client/src/orpc-contracts/`, run `pnpm --filter @flicktionary/api-client build` first — otherwise typecheck reads stale declarations and lies to you.

## Verify

```
pnpm --filter @flicktionary/web check:types
pnpm --filter @flicktionary/web lint
```

`lint` catches `useQueryClient` imports left behind after converting a hook to `meta.invalidates`.
