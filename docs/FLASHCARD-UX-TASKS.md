# Flashcard / Practice UX — task tracker

Tracker for a batch of flashcard improvements in the practice view. Each task is meant to be
tackled in its own focused session/PR (one or two tasks max per PR). Update the **Status** line
as work progresses (`todo` → `in progress (branch)` → `PR #N` → `done`).

Key code map (shared by most tasks):

- Flashcard render loop: `apps/web/src/features/practice/components/flashcard-mode-view.tsx`
- Card face slot config (per language, front/back): `packages/core/src/constants/card-face-config.ts`
- Counter pills: `apps/web/src/features/practice/components/review-queue-stats.tsx`
- Queue fetch (backend): `apps/backend/src/.../list-review-terms.ts` + `review-caps.ts`
- Rating flow: `rate-term.ts` → `applyTermRating()` → FSRS (`fsrs.ts`, `ts-fsrs`)
- Repository / queue queries: `user-lookups-repository.ts` (`listReviewTerms`, scopes `mixed` / `review_due` / `learn_new`)
- Contracts: `packages/api-client/src/orpc-contracts/practice-contract.ts`, `user-prefs-contract.ts`
  (after editing a contract: `pnpm --filter @flicktionary/api-client build`)
- Ratings audit log: `practice_rating_events` table (append-only; pre-rating SRS snapshots,
  `was_explicit`/`was_introduction`/`caused_parking` flags, `reverted_at` undo tombstone) —
  replaces the dropped `practice_ratings`

---

## 1. Active vocab: flip card front/back

**Status:** done (PR #107)

Active-vocabulary flashcards now test production, not recognition.

Implementation:

- `card-face-config.ts`: new language-independent `ACTIVE_CARD_FACE_CONFIG`
  (front `['definition', 'translation', 'nativeExample']`, back
  `['headword', 'ipa', 'targetExample', 'grammar']`); `getCardFaceConfig(code, pool)` grew a
  pool param (defaults to `'passive'`).
- Translations-off/missing fallback reuses the existing gloss resolver rules: translation is
  the prompt when present, definition otherwise (definition-first when translations are off +
  a manual translation exists). Definition gets prompt sizing (`text-lg`) on the front via a
  face param on `renderSlot`.
- Safety: a card with no translation, no definition and no example translation resolves to an
  empty active front — `flashcard-mode-view.tsx` falls back to the passive (recognition)
  layout for that card.
- Russian stress/IPA need no special-casing on active cards: the headword only appears on the
  back. `studied_form` cards prompt with the form's in-context translation.

## 2. Russian passive vocab: hide stress + IPA on front

**Status:** done (PR #107)

For Russian cards, the front showed the stressed display form (`находи́ться`) and IPA — both
leak the answer to "how is this pronounced". They are now revealed with the back.

Implementation:

- `card-face-config.ts`: ru config moved the `ipa` slot front → back (first back slot) and
  gained `hideStressOnFront: true` on `CardFaceConfig`.
- `flashcard-mode-view.tsx`: the headword slot strips the combining acute (U+0301,
  `stripStressMarks`) while the back is hidden; on reveal the stressed form swaps in place.
  Applies to `studied_form` fronts too.
- Scope: Russian only (en keeps front IPA), both pools — moot for active once task 1 flips
  the front. The reading-mode `rate-sheet.tsx` intentionally still shows stress/IPA in its
  title (it's not a recall test).

## 3. Example sentence: bigger, not italic

**Status:** done (PR #107)

In `flashcard-mode-view.tsx`, both example slots went `text-sm` → `text-base` and the target
example dropped `italic` (translation stays `text-lg`, so the hierarchy holds). The same
yellow-border example block in `rate-sheet.tsx` (reading mode) was de-italicized for
consistency (size untouched — compact sheet).

## 4. Bug: daily review limit refills on refresh

**Status:** done (PR #108, with task 9)

Implemented via a new append-only `practice_rating_events` table (the old
`practice_ratings` audit table was dropped with the session machinery — nothing
recorded rating events anymore). Every applied rating (flashcards AND reading
advances, both pools) logs an event in the same transaction as the FSRS write,
with pre-rating SRS snapshots so task 6 (undo) can build on it.

- `resolveReviewCaps`: review cap = clamped limit − `COUNT(DISTINCT
  user_lookup_id)` of today's non-introduction, review-state, non-reverted
  passive events (DB `CURRENT_DATE`, same timezone semantics as the new-card
  cap). In-session `again` redrills count once (DISTINCT); introductions
  consume the new budget instead.
- Learning/relearning follow-ups are exempt: `listReviewTerms` split the due
  query into review-state (budget-capped) and learning-state (hard-max-capped)
  sub-selects, so a spent budget can't strand a failed card's 10-min step.
- Landing shows "Daily review limit reached." (new `reviewedTodayCount` on the
  due summary) when due work exists only beyond the spent budget.
- Reading mode shares `listReviewTerms`, so it now honors the review budget
  too (intended; user-visible).

## 5. Learning counter flickers when failing a card

**Status:** done (PR #107)

Failing a card made the Learning pill go 35 → 34 → 35: counts derive from the local queue
(`getRemainingCounts()`), the index advance rendered immediately but the `again`-redrill copy
was only appended on mutation success.

Fix: the redrill copy is appended **optimistically in the same render** as the index advance
(React batches both setState calls), so the count never dips. It's rolled back by object
identity on the outcomes that must not redrill (cap-rejected rating, leech parking, mutation
error), guarded by an `indexRef` so a copy the user already consumed before a slow response
is never removed (that would shift the queue under the live index).

## 6. Allow re-rating from history (undo / change rating)

**Status:** in progress (feat/flashcard-rerate-edit)

Implemented: `rateTerm` returns the logged event's `eventId` (null when nothing
applied — disambiguates the two `parked: true` shapes); new `undoRating`
endpoint (`undo-rating.ts`) restores the pool's `prev_srs_*` snapshot via
`restoreSrsSnapshotForPool` (clears `added_to_practice_at` on
`was_introduction`, un-parks + zeroes rehab on `caused_parking`), stamps
`reverted_at`, all in one tx. Only the latest live event for (lookup, pool) is
undoable — a stale `eventId` returns `undone: false` (200, no restore). Client:
rating records keyed by `QueueItem` identity hold `{rating, eventId, redrill}`;
the peeked card shows `RateButtons` (previous rating highlighted) when its
redrill copy wasn't itself rated; re-rate = undo → fresh `rateTerm` with
redrill/sessionHard reconciliation; any unrated-server-side outcome re-appends
a fresh queue item.

Today the back-chevron is a read-only peek (`peekBack` state in
`flashcard-mode-view.tsx`). There is no undo endpoint yet — but everything an undo needs to
*restore* is now recorded.

### What PR #108 already provides

`practice_rating_events` (migration `20260606222256`, repo
`apps/backend/src/transport/database/practice-rating-events/practice-rating-events-repository.ts`)
logs one row per **applied** rating — flashcards AND reading advances, both pools — written
**in the same transaction as the FSRS write** (`withTransaction` on `RateTermDependencies`;
executor pattern: `applyFsrsResultForPool(params, tx)` / `insert(params, tx)`). Designed for
undo:

- **`prev_srs_*` snapshot** (state/due/stability/difficulty/last_review/reps/lapses) of the
  rated pool's SRS family at rating start. The `pool` column says which column family to
  restore into (`srs_*` vs `active_srs_*`). Plain restore — no FSRS recomputation needed.
- **`was_introduction`** (term was state-NULL): undo on a **passive** event additionally
  clears `srs_*` + `added_to_practice_at` (refunds the daily-new budget — that count comes
  from `added_to_practice_at >= CURRENT_DATE`); on an **active** event clears `active_srs_*`
  only (`added_to_practice_at` is never stamped for active intros).
- **`caused_parking`**: undo must un-park + zero the pool-prefixed rehab columns. No
  pre-rating parked/rehab snapshot exists because none is needed — the queue excludes parked
  terms and parked no-ops don't log, so they're constants NULL/0 at event time.
- **`reverted_at`** tombstone: stamp it on undo (append-only table — never delete). The
  review-budget counts (`countReviewBudgetConsumedToday*`) already filter
  `reverted_at IS NULL`, so reverting **automatically refunds the review budget** — no extra
  bookkeeping.
- Index `(user_lookup_id, rated_at DESC)` for "latest event for this card".
- Invariant: **no event rows exist for refusals** (cap-refusal, parked no-op,
  not-in-active-pool) — every logged event represents an applied FSRS write, so every event
  is undoable.
- `was_explicit` / `practice_text_id` distinguish flashcard ratings from reading-mode
  implicit 'good's, if undo should be flashcards-only at first.

### Still needed

- **Backend undo endpoint**, one transaction: load the latest `reverted_at IS NULL` event for
  (user_lookup, pool); restore `prev_srs_*`; apply the `was_introduction` /
  `caused_parking` side effects above; stamp `reverted_at`. Guard: only the **latest** event
  per (lookup, pool) is safely undoable — an older event's snapshot would clobber later
  ratings' state. Re-rate = undo + fresh `rateTerm` (Anki semantics).
- **Known gaps (accepted in #108, re-check at undo time):** `parkLeech` runs as a separate
  write *after* the event tx commits, so a crash can leave `caused_parking=true` with the
  term not actually parked (un-parking an unparked term is a no-op — harmless). Exercise-bank
  warming and rehab-day advances are fire-and-forget and NOT logged — out of undo scope.
- **Frontend:** turn the peeked card interactive (re-show rating buttons), then reconcile the
  local queue: a card re-rated `again` must be requeued; an `again`-redrill copy of a card
  re-rated `good`+ must be removed (see the `dropRedrill` identity/`indexRef` machinery from
  task 5 — same constraints apply). Mind `sessionHardRef` (again/hard set feeding
  Strengthen) on re-rate.
- Lapse counts restore via `prev_srs_lapses`, which keeps `shouldParkLeech`'s new-lapse-delta
  logic consistent after an undo.

This is one of the demanding ones — write a plan first. Pairs naturally with task 7.

## 7. Edit a card during practice

**Status:** in progress (feat/flashcard-rerate-edit)

Implemented via the focus view (matches the vocabulary rows and the reading
mode's "Edit term"): a kebab in the flashcard header opens a ResponsiveOverlay
actions menu whose "Edit term" row deep-links to
`/sessions/$sessionId/review/$cardId` with `from='practice'` +
`practiceMode='flashcards'` (new search param — the focus view's close
returns to the flashcard queue, scope reset to `mixed`). The card pointer
comes from the new `chunks.get` endpoint (`firstCardId`/`firstCardSessionId`
via the `first_card_id` back-pointer), fetched lazily on menu open so the
queue payload stays lean. `EditableCardFields`/`EditableGrammarPanel` were
refactored to take `chunk: Chunk` (+ `surfaceForm`) along the way. The
language-wide focus-view footer is now a single "Switch to active/passive
vocabulary" button for both vocabulary AND practice origins (the old
practice-origin "Add to" pair misrepresented already-kept terms). Known
tradeoff: navigating to the editor unmounts the client-side queue — on return
it re-seeds fresh (rated cards drop out, 'again' cards resurface as due
learning-state), but peek re-rate records don't survive the round-trip. An
earlier inline FloatingSheet editor was built and replaced by this flow
(clunky popover UX).

Anki-style: spot a mistake mid-review → edit the card → come back and rate it.

Existing pieces to reuse:

- `EditableCardFields` (focus view, per-field debounced PATCH to `user_lookups`) +
  `EditableGrammarPanel`.
- Practice **texts** already have an "Edit term" action that navigates to the focus view with
  `from='practice'` params and returns — flashcards have nothing.

Decide: inline edit (sheet/dialog over the card, reusing `EditableCardFields`) vs navigate to
focus view and restore session state on return. Inline avoids losing the local queue (the
session is client-side state; navigation drops it — same constraint as task 6). After an
edit, the current card's data must refresh in the queue.

## 8. Daily limits per language (migration)

**Status:** done (PR #111)

Move `practice_max_new_terms` / `practice_max_review_terms` from global (`users` table,
`practice-session-limits-setting.tsx`, `setPracticeSessionLimits` in
`user-prefs-contract.ts`) to per-language settings (the Languages settings screen backed by
`user_target_language_prefs`: currently `cefr_level`, `show_translations_enabled`).

- Migration (`20260607123340`): added the two columns NOT NULL with the existing defaults
  (20/100), backfilled from the `users` values, and **dropped the `users` columns in the same
  migration** — the same clean cutover as the show-translations move (`20260520094644`).
  Missing pref row ⇒ getter falls back to 20/100.
- Backend: `resolveReviewCaps()` + the rate-term daily-cap check must read per-language
  limits; clamping logic (`clampPracticeSessionLimits`, 0–100 / 0–300) moves with it.
- Post-#108 note: both daily budgets are already **counted** per (user, language, pool) —
  introductions via `added_to_practice_at`, reviews via
  `practiceRatingEventsRepository.countReviewBudgetConsumedToday`. Only the **limits** are
  global. `getPracticeSessionLimits` + `clampPracticeSessionLimits` have exactly three
  consumers to repoint at per-language values: `resolveReviewCaps` (fetch caps), the
  `rateTerm` handler in `practice-router.ts` (rating-time new-cap guard), and
  `advanceReadingText` (reading-time guard). The landing/`unified-review-view` also read
  `prefs.practiceMaxNewTerms`/`practiceMaxReviewTerms` client-side for the status line and
  drifting counts — those need the per-language values too.
- Contract changes in `user-prefs-contract.ts` (extend the per-language prefs endpoints, drop
  or deprecate the global one) → rebuild api-client.
- UI: move the two inputs from global settings into each language card in the Languages
  screen; remove the global section.
- Old `users` columns: dropped in the same migration (decided against keep-for-fallback /
  two-tier inherit — no dual-read logic anywhere).
- `rateTerm` wrinkle that surfaced: the router has no `targetLanguage` until the lookup row
  loads, so the per-language limit fetch moved INTO `rateTerm` (after `findByIdForUser`);
  the active pool skips the fetch entirely (no daily cap).

## 9. "Learn new" says "No terms are due" despite thousands of unlearned terms

**Status:** done (PR #108, with task 4)

"Learn new" (passive pool) now opens a FloatingSheet to pick a batch size
(5/10/15/20, plus "All N" when ≤ 20 unseen; disabled at 0 unseen). The chosen
N flows as `count` route search → `listReviewTerms.newBatchSize` (serves
exactly N unseen terms, ignoring the remaining daily-new budget) and the
session's ratings send `rateTerm.learnNewSession: true` (introduction guard
keeps the lock + stamp, drops only the cap predicate). Both bypasses are gated
on the chosen batch: a direct/bookmarked learn_new URL without `count` gets
neither (`newBatchSize` absent, `learnNewSession` false). Introductions still
stamp `added_to_practice_at`, so they count toward today and `mixed` won't
re-add more. The reading path deliberately does NOT bypass (no
`requestedNewCount` from the generator, no bypass on advance) — a URL-crafted
read+learn_new session stays within the daily budget. Empty-state copy is now
scope-aware ("No new terms to learn." / "No reviews are due right now."). The
active pool keeps direct entry (it has no daily cap).

---

## Suggested PR grouping

1. ~~**PR A (small, UI-only):** tasks 2 + 3 (Russian front, example styling)~~ — done, PR #107
2. ~~**PR B (UI):** task 1 (active card flip) — possibly with 5 (counter flicker)~~ — done, PR #107
3. ~~**PR C (caps rework):** tasks 4 + 9 (review budget tracking + learn-new bypass)~~ — done, PR #108
4. ~~**PR D (migration):** task 8 (per-language limits)~~ — done, PR #111
5. **PR E (session interactivity):** tasks 6 + 7 (re-rate + in-practice edit) — in progress (feat/flashcard-rerate-edit)
