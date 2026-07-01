# Prune the caller-less flashcard-bypass contract params

> **Status: proposal — not implemented.** Cleanup left over from the composed
> practice queue (PR `feat/composed-practice-queue`); pick up in a dedicated
> session.

## What's left over and why

The composed practice queue replaced the standalone flashcard lane: the
`/practice/review` route is reading-only, the learn-new batch sheet is gone,
and "learn past the daily cap" now happens on the **parking** side
(`composePracticeQueue`'s `learnExtraCount` → `bypassCap` on
`initializeAndParkCitationFacetIfUnderDailyCap`). That retired the only web
callers of the old flashcard-side bypass plumbing, which still exists
end-to-end:

- **`practice.listReviewTerms`** (contract `practice-contract.ts`) still
  accepts `newBatchSize`, threaded as `requestedNewCount` through
  `list-review-terms.ts` → `resolveReviewCaps` (`review-caps.ts`), where a
  `learn_new` scope with a requested count serves exactly N unseen terms
  ignoring the remaining daily-new budget. No web caller sends it anymore
  (the endpoint itself is also uncalled by the web app — the composed queue
  and the reading generator both reach the service layer server-side).
- **`practice.rateTerm`** still accepts `learnNewSession`, threaded as
  `bypassDailyCap` into `rateTerm` → `initializeCitationFacetIfUnderDailyCap`
  (`study-facets-repository.ts:225`, the *flashcard-introduction* guard — a
  different method from the warm-up park guard, whose `bypassCap` IS in use).
  No web caller sends it.

Noted in `docs/SRS.md` §"Over-cap learning" so the vestige isn't mistaken for
live behavior.

## Proposed cleanup

1. Drop `newBatchSize` from the `listReviewTerms` contract input, and
   `requestedNewCount` from `list-review-terms.ts` / `resolveReviewCaps` (the
   `learn_new`-with-count branch in `review-caps.ts` goes with it).
2. Drop `learnNewSession` from the `rateTerm` contract input and
   `bypassDailyCap` from `rate-term.ts`'s options (keep the repo-level
   `bypassCap` on `initializeCitationFacetIfUnderDailyCap` ONLY if something
   still uses it — at the time of writing nothing does once `learnNewSession`
   is gone; the warm-up park guard's `bypassCap` is separate and stays).
3. Decide whether `practice.listReviewTerms` should remain a public endpoint
   at all: after the composed queue, nothing in `apps/web` calls it (check
   `orpcQuery.practice.listReviewTerms` usages first). The service function
   stays regardless (the composer and the reading generator consume it
   server-side).
4. Rebuild `@flicktionary/api-client`, update `rate-term.unit.test.ts` /
   `list-review-terms.unit.test.ts` for the removed branches, and update
   `docs/SRS.md` §"Over-cap learning" (drop the vestige note) + §3's
   learn-new-batch mentions if any remain.

## Constraints / cautions

- Deployed-client window: removing input fields is safe for clients that never
  send them, but a stale cached web bundle from before the composed queue
  would still call `listReviewTerms` with `newBatchSize` and `rateTerm` with
  `learnNewSession` — removal makes those requests fail Zod validation
  (unknown keys are stripped by oRPC only if the schema isn't strict; verify
  before assuming). Ship in a quiet window like the pool rename (#129).
- Anki-style "custom study exactly N" as a *flashcard* feature is gone either
  way; if it's ever wanted back, it should be rebuilt on the composed queue's
  filter spec, not by resurrecting these params.
