# Practice edit-detour resume & Daily Mix exit fixes

> **Status: reference.** Record of three practice-session bugs found while dogfooding the Daily Mix (2026-07-22): root causes and the fixes as implemented. The resulting behavior is (or will be) specced in `docs/SRS.md`; this doc keeps the diagnosis and the design rationale.

All three bugs share one trigger: the practice session queues are **client state**. Navigating away — most commonly the header kebab's "Edit term" detour into the review focus view — unmounts the serving view, and anything not deliberately preserved is lost.

## 1. "Exercise is no longer answerable" after an edit detour (composed queue)

**Symptom.** Answer an exercise in the composed queue (e.g. a warm-up gate in a Daily Mix), open the 3-dot menu → Edit term, return via the focus view's back chevron. The exercise re-renders as answerable; tapping an option shows the toast "Exercise is no longer answerable" and the card becomes a dead end.

**Root cause.** Answering is consume-on-answer server-side: `submitExerciseAnswer` flips the `practice_exercises` row `ready → used`, and any later submit is rejected with a 400 (`apps/backend/src/router/practice-router/practice-router.ts`). The composed view stashes its whole session across the detour (`composed-session-snapshot.ts`), including an `exerciseOutcomes` map — but only the *peek-back* render path consulted that map. The **live** path remounted `McExercise` fresh, whose `result`/`selected` are plain component state, so an already-answered exercise came back looking answerable. (The sequence is forced, not incidental: the Edit-term kebab is withheld on unanswered cloze exercises because the focus view would spoil the answer, so the detour can only start *after* answering.)

**Fix.** A consumed exercise never remounts its live component again:

- `answered-exercise-panel.tsx` — shared read-only panel for a consumed exercise (outcome icon, headword, "Exercise answers can't be changed.", one action button). The peek path now uses it too, replacing its inline copy.
- `composed-practice-view.tsx` captures `restoredAnsweredItem` on resume: the current queue item, when the restored outcome map already has an entry for it. The live render path shows the panel with a **Next** action (Enter/Space bound host-side) instead of the exercise component. `currentAnswered` initializes true in that case so the Edit-term kebab stays available.

The full pre-detour feedback (selected option, meaning line, rehab note) is deliberately not restored — that would require persisting the user's response alongside the outcome for a state visible only until the next tap, and after an edit the exercise text may contradict the edited card anyway.

## 2. Edit detour restarts a Strengthen/Warm-up session from scratch

**Symptom.** Mid-Strengthen (e.g. "Strengthen English first" from the mix interstitial), edit a term and come back: the whole session restarts at 1/N and every exercise is re-served.

**Root cause.** The composed queue got a snapshot/resume stash (PR #231); the dedicated exercise sessions never did. `StrengthenView`/`WarmupView` fire a one-shot start mutation on mount and hold the queue in component state; the focus view's close navigates back to the route, which is a fresh mount → a fresh start call → a new queue at position 0. (The old comment claiming "serving is resume-safe server-side" only covered unanswered exercises re-serving — facets still mid-rehab recompose into the new session.)

**Fix.** `exercise-session-snapshot.ts` — the composed stash pattern applied to `ExerciseSessionView`:

- Snapshot `{queue, index, correctCount, currentOutcome, dailyLimitReached}` saved on unmount, **only** for interrupted sessions (the X and completion/empty-state exits set `endedRef` and clear instead). Consume-on-read, never across a local day boundary.
- The stash key is the session scope — mode + language + pool + studySessionId + sorted `sessionHard` + mix — so a resume only matches the identical route re-entry.
- `currentOutcome` is the answered-but-not-advanced current exercise; a resume renders it as the shared read-only panel (fix 1's mechanism, without which this fix would reproduce fix 1's bug here).
- Both chunk soft-delete mutations splice the deleted term's not-yet-reached entries out of the stash (`dropTermFromExerciseSession`, mirroring `dropTermFromComposedSession`). When the removed entry is the answered current one, its `currentOutcome` is cleared and a correct answer leaves `correctCount` with it — the entry no longer counts in the completion total, so keeping its answer could report more correct than the total.

**Latent bug fixed alongside.** The Edit-term return trip carried the *term's* pool as `practicePool`, but a strengthen queue can contain again/hard bonus terms of either pool — returning under the term's pool would rebuild a different route (`?pool=production`), start a different session, and defeat the resume key. The kebab now carries the session's route pool (`sessionPool` on `ExerciseSessionView` → `TermActionsOverlay`).

## 3. Mix-end "Back to English" that actually opens Portuguese

**Symptom.** Finishing the Strengthen leg of a mix language shows a "Back to English" CTA that navigates to the *next* language's exercises. Relatedly, finishing the whole mix dropped the user on the last language's landing page — a destination they never chose.

**Root cause.** `StrengthenView` passed `backLabel={t`Back to ${languageName}`}` unconditionally while its `close()` was already mix-aware (mid-mix it continues the chain). Label and action disagreed. Re-showing the interstitial instead was considered and rejected: it lives inside `composed-practice-view` with the finished session's recap tallies, which are gone by then, and its only remaining action would be "Continue" — the strengthen completion screen already is the breather.

**Fix.** Labels now say where `close` goes, and mix exits follow return-to-origin:

- Strengthen completion mid-mix: **"Continue with ⟨next language⟩"** (interstitial copy); plain sessions keep "Back to ⟨language⟩".
- Every mix exit from the composed view — mix-complete **Finish**, the interstitial's "Done for now", the header X — navigates to `/dashboard`. The mix is dashboard-owned (its banner is the only entry point) and the dashboard is the payoff screen for a finished mix. A strengthen launched from the mix-final completion screen also ends at the dashboard ("Finish").
- Plain single-language sessions are untouched: they start from a language landing and return to it. If a second mix entry point ever ships (e.g. on the Practice tab), carry a `from` search param alongside `mix` and return to the true origin.

## Verification

Web typecheck, repo lint, and all web unit tests pass, including the new `exercise-session-snapshot.unit.test.ts` (key matching incl. unordered `sessionHard`, consume-on-read, day boundary, deleted-term splice). Manual smokes: answer → edit → back shows the read-only outcome; mid-strengthen detour resumes at position N; end-of-mix Finish lands on the dashboard.
