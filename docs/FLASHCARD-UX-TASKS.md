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
- Ratings audit log: `practice_ratings` table (immutable, snapshot columns, `was_explicit` flag)

---

## 1. Active vocab: flip card front/back

**Status:** todo

Active-vocabulary flashcards should test production, not recognition:

- **Front:** translation of the term + translation of the example sentence.
  Fallback when translations are off/missing (per-language "generate translations" pref):
  show the **definition** instead (and skip/fall back gracefully for the example translation).
- **Back:** the term (headword) + the target-language example sentence.

Pointers:

- Front/back slot ordering comes from `card-face-config.ts`; today the config is keyed by
  language, not by pool. Likely needs pool-aware configs (active vs passive) or a separate
  active-vocab config.
- Slot rendering (headword / ipa / targetExample / nativeExample / translation / definition):
  `flashcard-mode-view.tsx` ~lines 222–278.
- Translation-off fallback already exists for the **definition** slot (fallback gloss when
  translations disabled) — reuse that logic for the new front.

## 2. Russian passive vocab: hide stress + IPA on front

**Status:** todo

For Russian passive cards, the front currently shows the stressed display form
(`находи́ться`) and IPA — both leak the answer to "how is this pronounced". They should only
be revealed on the back (after Show answer / rating).

Pointers:

- Russian front config includes the `ipa` slot: `card-face-config.ts` (~lines 32–35) — move it
  to back for Russian.
- Stress marks come pre-embedded in `grammar.display_form` (rendered via `StressMarkedText`,
  `stress-marked-text.tsx`); the **headword** slot falls back to the plain (unstressed)
  headword — on the front, render plain headword; on the back, the stressed display form.
- Scope: Russian only, passive pool (active front won't show the term at all after task 1).

## 3. Example sentence: bigger, not italic

**Status:** todo

Target-language example is too small and italic. Current styling in
`flashcard-mode-view.tsx`:

- target example (~line 247): `border-l-2 border-yellow-300 pl-3 text-left text-sm italic`
- native example (~line 253): `text-muted-foreground pl-3 text-left text-sm not-italic`

Drop the italic, bump `text-sm` up (e.g. `text-base`/`text-lg` — eyeball it). Small, can ride
along with task 1 or 2 in the same PR.

## 4. Bug: daily review limit refills on refresh

**Status:** todo — root cause confirmed

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

**Status:** todo

Failing a card makes the Learning pill go 35 → 34 → 35. Cause is structural, not a bug:

- Counts are derived from the **local queue** via `getRemainingCounts()`
  (`flashcard-mode-view.tsx` ~lines 43–66).
- Rating `again` removes the card (count drops), then re-appends it with
  `requeuedForAgain: true` (~line 141), which counts as learning again (count back up).

Fix direction: compute the post-rating queue (removal + requeue) in one state update so the
intermediate value never renders, or derive counts in a way that keeps the failed card
counted continuously.

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

**Status:** todo

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
