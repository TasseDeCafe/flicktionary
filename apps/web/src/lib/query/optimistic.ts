import type { QueryClient, QueryKey } from '@tanstack/react-query'

// One optimistic cache patch: a key filter (oRPC `.key()` prefix or
// `.queryKey()` exact key) plus an immutable updater applied to every matching
// query. Build with `optimisticPatch` to keep the updater typed.
export type OptimisticPatch = {
  queryKey: QueryKey
  update: (old: unknown) => unknown
}

// Typed patch constructor. The cast is the same trust boundary as
// `queryClient.setQueriesData<TData>` — the caller asserts what the cache
// holds under that key; confining it here keeps hook code cast-free.
export const optimisticPatch = <TData>(
  queryKey: QueryKey,
  update: (old: TData | undefined) => TData | undefined
): OptimisticPatch => ({ queryKey, update: update as (old: unknown) => unknown })

export type OptimisticContext = { rollback: () => void }

// The cancel → snapshot → patch ceremony shared by optimistic mutations. Call
// from onMutate and return the result as the mutation context; wire onError to
// `context?.rollback()`. Pair with meta.invalidates for the settle-time
// refetch that makes the server's view the truth.
export const applyOptimistic = async (
  queryClient: QueryClient,
  patches: readonly OptimisticPatch[]
): Promise<OptimisticContext> => {
  await Promise.all(patches.map((patch) => queryClient.cancelQueries({ queryKey: patch.queryKey })))
  const snapshots = patches.map((patch) => queryClient.getQueriesData({ queryKey: patch.queryKey }))
  for (const patch of patches) {
    queryClient.setQueriesData({ queryKey: patch.queryKey }, patch.update)
  }
  return {
    rollback: () => {
      for (const snapshot of snapshots) {
        for (const [queryKey, data] of snapshot) {
          queryClient.setQueryData(queryKey, data)
        }
      }
    },
  }
}

// Apply a row transform to every page of a cursor-paginated infinite cache.
// Spreading the page preserves nextCursor and any other page fields. The rows
// type is derived from `old` (indexed access) so callers get full inference;
// the cast inside is sound because page.rows IS that type by construction.
type PageRows<TData extends { pages: Array<{ rows: unknown[] }> }> = TData['pages'][number]['rows']

export const patchInfinitePages = <TData extends { pages: Array<{ rows: unknown[] }> }>(
  old: TData | undefined,
  mapRows: (rows: PageRows<TData>) => PageRows<TData>
): TData | undefined => {
  if (!old) return old
  return {
    ...old,
    pages: old.pages.map((page) => ({ ...page, rows: mapRows(page.rows as PageRows<TData>) })),
  }
}
