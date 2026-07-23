# Sessions list scaling (virtualization, pagination, difficulty caching)

> **Status: proposal.** Open design for scaling the Sessions list view and the
> batched difficulty read past a few hundred sessions. Nothing here is current
> behavior; the view is fine at current scale and none of this is scheduled.

## Problem

`apps/web/src/features/sessions/components/sessions-list-view.tsx` assumes the
full session list is small and in memory:

- `studySessions.list` returns **every** session the user has, in one
  response, with no pagination (`study-sessions-router.ts`). Type/language
  filters, search, and sort are all client-side array operations.
- Every filtered card mounts — no virtualization. Thousands of sessions means
  thousands of `SessionCard` DOM nodes.
- The difficulty stat is fetched for the full session list via
  `useSessionDifficulties` (chunked at the 100-id contract cap, one HTTP call
  per chunk). Request count scales as ⌈N/100⌉ — acceptable — but each chunk is
  a heavy live computation server-side.

Server-side, `getSessionDifficulties`
(`apps/backend/src/service/difficulty/session-difficulties.ts`) computes
groups concurrently (bounded by the DB pool) and loads the per-user
vocab/known-lemma side once per language **per request** — so k parallel
chunk requests repeat that per-language load k times, and each distinct track
in a chunk costs a full profile read + rank lookup + FSRS pass.

None of this hurts at double- or triple-digit session counts. The cliffs, in
the order they'd be hit:

1. **DOM weight** — thousands of mounted cards (list render, not network).
2. **Difficulty compute** — many distinct tracks × live per-chunk computation.
3. **List payload** — session rows are small; this cliff is likely past tens
   of thousands of sessions.

## Track A — virtualization + viewport-driven difficulty (frontend only)

The first move, because it fixes cliffs 1 and 2 without touching the API and
preserves the instant client-side search/filter UX.

- Extract the data story into one hook with the signature a server-driven
  version would have:
  `useSessionListItems({ type, lang, search, sort }) → { items, totalCount, isLoading }`.
  It returns **display items** (`group | session`, i.e. `buildSessionListItems`
  moves inside), so the view stops knowing where filtering and TV-grouping
  happen. Internally it stays client-side.
- Virtualize the item list (TanStack Virtual). The card list is flat and
  fixed-height-ish; the group card and session card can share one row
  estimate.
- Drive `useSessionDifficulties` from the virtualizer's rendered range instead
  of the full list: accumulate ids as rows become visible ("sessions the user
  has scrolled past"), so batches fill lazily and the first paint costs one
  ≤100-id chunk. Keep the accumulated set monotonic within a mount so
  scrolling back up never refetches.
- The 4s pending-poll then only covers scrolled-past sessions.

## Track B — server-side pagination (backend + frontend)

Only needed if the full-list payload itself becomes a problem (cliff 3), or if
`listByUserIdWithSource` gets slow. Most of the cost is backend:

- `studySessions.list` grows `{ limit, cursor, type?, lang?, search?, sort }`;
  filter/search/sort move into SQL. Keyset pagination on
  `(last_activity_at, id)` (the current client sort), not offset.
- **TV grouping is the awkward part**: the page unit should be *display items*
  (a show collapsed to one card), which means the server must group episodes
  before paginating — e.g. paginate over `DISTINCT ON` show-or-session rows,
  or a lateral aggregate per show. This changes the response shape (list of
  `group | session` DTOs), which Track A's hook already isolates from the view.
- Frontend: the hook's internals become `useInfiniteQuery` + a bottom
  sentinel; search input debounces into the query input. The chips/search/sort
  UI is unchanged.
- `availableLanguages` (filter chips) needs its own tiny aggregate endpoint
  once the client no longer sees the full list.

Track B strictly follows Track A — the hook seam is the first commit of
either.

## Track C — difficulty compute caching (backend)

Independent of A/B; relevant if difficulty requests get slow even at page
granularity. Per the design note in `session-difficulties.ts`, caching goes on
the **profile side, never the blended number** (the blend must stay live —
vocab and FSRS state move constantly).

Candidates, cheapest first:

- **Per-track candidate-lemma rollup**: the per-group profile read pulls every
  token row (`SELECT * … ORDER BY folded_token`) only to union
  `candidate_lemmas` and sum token counts. A materialized per-track rollup
  (distinct candidate lemmas + token-count-per-group array), refreshed by the
  profile build job, turns the dominant per-group read into one small row.
- **Per-request memo of the rank lookup** across groups sharing a language.
- **Cross-request knowledge-map reuse**: the per-(user, language) vocab load +
  FSRS pass is recomputed per request. A short-TTL in-process memo (seconds)
  would collapse the k-parallel-chunks duplication; anything longer needs
  invalidation on every vocab/known-lemma/rating write and is probably not
  worth it.

## Triggers

- Track A: when a real account approaches ~500 sessions, or the list view
  visibly jank-scrolls.
- Track B: when the `list` payload or query time is measurably slow —
  probably ≥10k sessions.
- Track C: when `getDifficulties` p95 is slow for ≤100-id batches of distinct
  tracks (watch Railway response-time metrics after A ships, since A shrinks
  batch sizes and may make C unnecessary).
