# Dashboard redesign & Daily Mix

> **Status: implemented** (shipped 2026-07-21 on `feat/dashboard-redesign`; kept for design rationale). Current behavior lives in `SPEC.md` (dashboard home, stats view, navigation, sessions library) and `docs/SRS.md` (Daily Mix, `dueSummary.lastPracticedAt`) — the "Current-state grounding" below describes the **pre-implementation** state and is deliberately left as written. Design source: Claude Design project `5decb271-6f8f-472b-bca2-3e505c3056a0`, file `Dashboard Final.dc.html` — a **wireframe**, not a pixel spec; it was drawn from screenshots without codebase access.

## Current-state grounding (verified 2026-07-21, pre-implementation)

- Home is `/sessions` (`apps/web/src/app/routes/index.tsx` is a bare redirect). There is no dashboard route. `SessionsListView` (`apps/web/src/features/sessions/components/sessions-list-view.tsx`) hard-codes `GettingStartedChecklist` and `CoverageCard` above the filtered session list.
- Navigation config is duplicated across `bottom-tab-bar.tsx` (mobile, 4 tabs + yellow `+` FAB) and `sidebar-nav.tsx` (desktop, same 4 items + `+ New`), both in `apps/web/src/features/navigation/components/`. Tabs: Sessions / Practice / Vocabulary / More.
- Coverage viz: `apps/web/src/features/coverage/` — `CoverageCard` (per-language chips, dot wall, ~N% of typical text) fed by oRPC `coverage.getCoverage`; drill-in `CoverageDetailView` at `/coverage/$lang`.
- Activity/streak: **nothing exists** frontend or as a read endpoint. `coverage_snapshots` (per user/language/UTC-day cumulative counts) is written lazily, fire-and-forget, on coverage reads — read path absent and data has day gaps. Event-accurate sources: `practice_rating_events` (timestamps + `target_language`), known-lemma timestamps.
- Session rows: `SessionCard` + `SessionDifficultyStat` ("~80% comfortable/frustrating", batched `studySessions.getDifficulties`). Meta line currently shows `year · LANG · CEFR`. TV episodes group via `deriveTvShows` → `ShowGroupCard`.
- Practice: fully per-language (`composePracticeQueue`/`previewPracticeQueue` take explicit `targetLanguage`; budgets per-language on `user_target_language_prefs`; no practice zustand store; backend stateless with per-language advisory locks). `dueSummary` (GET `/practice/due-summary`) already returns one row per language with due/learning/new/warmup/parked counts — ordered alphabetically. Session view `composed-practice-view.tsx` composes one-shot per mount; single-slot in-memory resume stash in `composed-session-snapshot.ts` (keyed language+filter+day).

## Part 1 — Dashboard / Sessions / Analytics restructure

### Decided

- New `/dashboard` route becomes the home redirect target. `/sessions` keeps the full list, minus the graphs (checklist + coverage card move off it).
- Sessions leaves the mobile bottom nav (only 5 slots); tab becomes Dashboard. Sessions reached via the dashboard "Recent → All sessions" link (desktop sidebar keeps a Sessions entry).
- Dashboard content (mobile): date header; swipeable carousel of two slides — Coverage and Activity; "Recent" preview (few most-recent sessions) with "All sessions" link. Desktop: two-card grid (coverage + activity) + Recent grid.
- Coverage dot grid: **keep the existing renderer as-is** — only the surrounding data presentation changes. Dashboard shows the quick view; richer graphs go to the new Analytics view.
- Activity slide: net-new. Per-day bars (new terms + marked known), streak badge, language chips (All + per-language). Bars are pressable to inspect a specific day's numbers (the black outline in the design marks the selected/today bar). Needs a new backend read endpoint built on event tables (not `coverage_snapshots`).
- Streak = **any activity including reading** — deliberately easy to keep (app philosophy: reading is review).
- Recent/session rows: drop the CEFR chip from the meta line (it shows the *user's* level, reads as the content's level — misleading).
- New Sessions view: keep TV-show grouping; add search, sort, count, and filters (type + language) behind a filter affordance matching the Vocabulary tab pattern — popover on desktop, sheet on mobile.
- New **Stats** view: rich-data view for data nerds — existing coverage graphs, activity, more later (sub-views possible, keep simple for now). Has a language filter. Desktop: sidebar entry; mobile: reachable from the dashboard cards ("More stats" link) and a More-tab entry.
- Streak day = any day with a `practice_rating_events` row, a known-lemma mark, or a checkpoint claim. Merely opening a session does **not** count.
- `GettingStartedChecklist` stays, at the top of the dashboard above the carousel.

### Open

- Shape of the activity endpoint (per-day series: window, per-language split, streak included in same response?) — settle during planning.

## Part 2 — Daily Mix

One dashboard CTA that clears every language's practice queue sequentially, as an orchestration layer over existing per-language sessions. Design screens: 3a (yellow banner, chosen entry point; chips wrap past one line, truncate to "+N more" past ~6 languages), 3c (between-language interstitial), 3d (desktop banner), 3e (8-language wrap example).

### Decided

- Entry: yellow banner card on the dashboard — aggregate count + ordered chip queue (RU 5 → DE 12 → …) + Start.
- The aggregate/per-chip numbers must equal **the sum of what the per-language practice landing shows** (session-plan card semantics: due + planned introductions) — no surprises on entry.
- Ordering: extend `listDueSummary` with `lastPracticedAt` (`MAX(created_at)` over `practice_rating_events` per language); last-practiced first.
- Interstitial (3c) between languages: completed-language recap ("Russian — done · 5 cards · 2 new · 3 warmed up"), mix progress chips, "Up next" card with Continue / Done for now. Recap tally derived client-side from the composed view's in-memory `ratingRecords` / `isNewIntroduction` / `origin === 'onboarding'` — needs hoisting before advancing (nothing persisted today).
- Strengthen: keep as a skippable option after each language (on the interstitial). "Learn +N extra" is dropped from the mix — remains available on the individual practice landing views.
- Exit/resume: no mix-progress persistence needed — ratings persist per card, so re-entering recomputes `dueSummary`; finished languages drop out naturally. "Done for now" just exits.
- Single-language degradation: queue of length 1, no interstitial — behaves like a plain practice button.
- Mix-state mechanism: **search param on the existing route** (e.g. `/practice/composed/ru?mix=de,en` carries the rest of the chain; completion renders the interstitial when `mix` is present; "Continue" navigates to the next language). No store, refresh-safe, composed view keeps its one-shot-per-mount model. If the mode branching makes `composed-practice-view.tsx` too noisy, write a small follow-up proposal to extract a wrapper route.

### Open

- Whether the banner shows when nothing is due (hide vs. "all caught up" state).
