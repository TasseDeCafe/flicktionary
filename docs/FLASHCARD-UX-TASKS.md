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

**Status:** done (this branch)

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

**Status:** done (this branch)

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

**Status:** done (this branch)

In `flashcard-mode-view.tsx`, both example slots went `text-sm` → `text-base` and the target
example dropped `italic` (translation stays `text-lg`, so the hierarchy holds). The same
yellow-border example block in `rate-sheet.tsx` (reading mode) was de-italicized for
consistency (size untouched — compact sheet).

## 4. Bug: daily review limit refills on refresh

**Status:** done (feat/practice-caps-rework, with task 9)

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

**Reading of the problem confirmed.** The daily limits (`practice_max_new_terms`,
`practice_max_review_terms` on `users`) are applied as **query LIMITs at fetch time**, not as
a budget decremented by reviews done today:

- `listReviewTerms()` → `resolveReviewCaps()` (`review-caps.ts` ~lines 34–49): only **new
  introductions** are tracked against the day (`newIntroducedTodayCount` from
  `added_to_practice_at >= CURRENT_DATE` in `user-lookups-repository.ts` ~lines 349–352).
- **Reviews are not counted at all** — the review cap is just `LIMIT maxReviewTerms` on the
  due-cards query. With 150 due and a limit of 100: fetch → 100, review 50, refresh →
  the query again returns `LIMIT 100` from the remaining ~100 due cards → "100 left".

Fix direction: track reviews done today per (user, language, pool) — the immutable
`practice_ratings` audit table already records every rating with timestamps, so a
`COUNT(*) ... WHERE created_at >= CURRENT_DATE` (careful: explicit vs implicit ratings,
in-session `again` redrills shouldn't double-count) can feed
`remainingReviews = maxReviewTerms - reviewedTodayCount`, mirroring how new-card
introductions already work. Decide timezone semantics (DB `CURRENT_DATE` is what the
new-card cap already uses — stay consistent).

Depends on / interacts with: task 8 (limits become per-language) and task 9 (Learn-new uses
the same caps). Worth planning these three together even if shipped separately.

## 5. Learning counter flickers when failing a card

**Status:** done (this branch)

Failing a card made the Learning pill go 35 → 34 → 35: counts derive from the local queue
(`getRemainingCounts()`), the index advance rendered immediately but the `again`-redrill copy
was only appended on mutation success.

Fix: the redrill copy is appended **optimistically in the same render** as the index advance
(React batches both setState calls), so the count never dips. It's rolled back by object
identity on the outcomes that must not redrill (cap-rejected rating, leech parking, mutation
error), guarded by an `indexRef` so a copy the user already consumed before a slow response
is never removed (that would shift the queue under the live index).

## 6. Allow re-rating from history (undo / change rating)

**Status:** todo — needs a plan

Today the back-chevron is a read-only peek (`peekBack` state, `flashcard-mode-view.tsx`
~lines 87–88, 301–315). Ratings are immutable one-way writes (`applyTermRating`); there is no
undo endpoint.

Needs:

- Backend: an undo/re-rate operation. FSRS state is overwritten on rating, so undo requires
  either storing the pre-rating SRS snapshot (e.g. on `practice_ratings`) to restore, or
  recomputing. Also must roll back side effects: lapse count, leech parking, daily-cap
  introduction count for new cards.
- Frontend: turn the peeked card into an interactive card (re-show rating buttons), then
  reconcile the local queue (e.g. a card re-rated `again` must be requeued; one re-rated
  `good` that was requeued must be removed).
- Anki semantics for reference: undo restores the card's previous state and review log entry.

This is one of the demanding ones — write a plan first. Pairs naturally with task 7.

## 7. Edit a card during practice

**Status:** todo — needs a plan (pairs with 6)

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

**Status:** todo — needs a plan

Move `practice_max_new_terms` / `practice_max_review_terms` from global (`users` table,
`practice-session-limits-setting.tsx`, `setPracticeSessionLimits` in
`user-prefs-contract.ts`) to per-language settings (the Languages settings screen backed by
`user_target_language_prefs`: currently `cefr_level`, `show_translations_enabled`).

- Migration: add the two columns to `user_target_language_prefs` (nullable with fallback, or
  backfill from `users` values for existing rows). **Append-only migrations** — create via
  `supabase migration new` from dev-tunnel.
- Backend: `resolveReviewCaps()` + the rate-term daily-cap check must read per-language
  limits; clamping logic (`clampPracticeSessionLimits`, 0–100 / 0–300) moves with it.
- Contract changes in `user-prefs-contract.ts` (extend the per-language prefs endpoints, drop
  or deprecate the global one) → rebuild api-client.
- UI: move the two inputs from global settings into each language card in the Languages
  screen; remove the global section.
- Decide what happens to the old `users` columns (keep for fallback vs drop in a later
  migration).

## 9. "Learn new" says "No terms are due" despite thousands of unlearned terms

**Status:** done (feat/practice-caps-rework, with task 4)

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

`Learn new` (`practice-language-view.tsx` ~lines 146–154) enters scope `learn_new`, which is
capped by the **remaining daily new-card budget** (`resolveReviewCaps`, `review-caps.ts`
~line 47). Once today's new-card cap is consumed, `newLimit=0` → empty queue → "No terms are
due right now", even with 2500+ never-introduced terms.

Intent of the button: learn **more** new terms on demand, beyond the daily drip. Fix
direction: `learn_new` scope should bypass (or extend) the daily cap — explicit user intent,
like Anki's "Custom study → increase today's new card limit". Decide whether the extra
introductions still count toward today's count (they should, so `mixed` doesn't re-add more)
and whether to confirm/ask "Learn N more?". Also fix the misleading empty-state copy.

Interacts with task 4/8 (caps logic) — coordinate.

---

## Suggested PR grouping

1. **PR A (small, UI-only):** tasks 2 + 3 (Russian front, example styling)
2. **PR B (UI):** task 1 (active card flip) — possibly with 5 (counter flicker)
3. **PR C (caps rework):** tasks 4 + 9 (review budget tracking + learn-new bypass) — plan first
4. **PR D (migration):** task 8 (per-language limits) — plan first; lands cleanly before or after C, but coordinate the caps code
5. **PR E (session interactivity):** tasks 6 + 7 (re-rate + in-practice edit) — plan first
