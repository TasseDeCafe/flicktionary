# Effect-lint cleanup (eslint-plugin-react-you-might-not-need-an-effect)

> **Status: historical.** Archived 2026-07-03 — all six phases shipped (PRs #197–#202; phase 6 was this docs-only close-out). The plugin runs in `apps/web` at a zero-warning baseline (`--max-warnings 0` + reasoned suppressions); the surviving suppressions carry their own self-contained reasons in the code. Kept for the triage rationale and the decision record on not extending to `packages/ui` / `apps/extension`.

## Goal

Enable `eslint-plugin-react-you-might-not-need-an-effect` in `apps/web` at a permanently-zero-warning baseline, then remove the effects it correctly flags, cluster by cluster, without breaking load-bearing flows.

The plugin is **already installed** (`apps/web` devDep via the pnpm catalog) and sits commented out in `apps/web/eslint.config.cjs` with a "deal with the warnings" TODO. This plan is that triage.

## Why the baseline discipline matters more than the plugin

A lint output that permanently contains known-false warnings trains readers (humans and models) to ignore lint output entirely. The rules:

- Every false positive is suppressed **with a reason**: `// eslint-disable-next-line react-you-might-not-need-an-effect/<rule> -- <why this effect is genuinely needed>`. The reason does double duty: lint stays clean, and the justification sits exactly where a future refactor would otherwise "fix" a load-bearing effect.
- Suppressions must carry descriptions (`@eslint-community/eslint-plugin-eslint-comments` `require-description`) and stale ones must fail (`linterOptions.reportUnusedDisableDirectives: 'error'`).
- `--max-warnings 0` on the `apps/web` lint script keeps the baseline at zero; after PR1, any warning is new and worth investigating.
- If a rule proves chronically noisy for our patterns, disable that rule rather than tolerating its noise.

## Baseline scan (2026-07-03, plugin v1.0.1, recommended config over `apps/web/src`)

68 warnings across 20 files. By rule:

| rule | count |
| --- | --- |
| no-event-handler | 29 |
| no-chain-state-updates | 14 |
| no-adjust-state-on-prop-change | 14 |
| no-derived-state | 8 |
| no-external-store-subscription | 2 |
| no-pass-data-to-parent | 1 |

Rule names are identical between the catalog's 0.9.2 and 1.0.1 (1.x adds `no-external-store-subscription`, drops `no-empty-effect`), so suppressions written against 1.0.1 are stable.

Also relevant: 2 pre-existing `react-refresh/only-export-components` warnings (`flashcard-face.tsx`, `chat-panel.tsx`) must be resolved for `--max-warnings 0` to pass.

## Test strategy for the refactor phases

`apps/web` has no React Testing Library / jsdom and we deliberately don't add one for this (integration tests are paused repo-wide; manual golden paths are the regression net). The house pattern for effect logic is **extract-and-test**: pull the decision logic out of the effect into a pure function, characterize it with Vitest unit tests while the effect still calls it, then restructure (render-time derivation / event handler) with the tests unchanged. Precedents: `composed-queue-merge.unit.test.ts`, `exercise-queue-merge.unit.test.ts`, `build-recap-questions.unit.test.ts`.

For load-bearing flows (gloss sheet, composed queue, reading position), each refactor PR additionally gets a manual golden path before merge.

## Phases

Update the status line of a phase when you start/finish it. One phase ≈ one PR.

### Phase 1 — enable at zero, no behavior change (PR1)

**Status: merged (PR #197).**

- Bump catalog `eslint-plugin-react-you-might-not-need-an-effect` 0.9.2 → 1.0.1.
- Add `@eslint-community/eslint-plugin-eslint-comments` (catalog + `apps/web` devDep).
- Enable the plugin's `recommended` config in `apps/web/eslint.config.cjs`; add `reportUnusedDisableDirectives: 'error'` + `require-description`.
- Add `--max-warnings 0` to the `apps/web` lint script.
- Suppress **every** warning with a reasoned `-- <why>` — including apparent true positives. PR1 is strictly zero behavior change; fixes happen in the phase PRs so each is individually revertable and testable.
- Fill the triage table below while reading each effect.
- Fix/suppress the 2 pre-existing react-refresh warnings.

### Phase 2 — trivial true positives

**Status: merged (PR #198), manually checked.**

Effects whose removal is a local, low-risk rewrite (derived state, seed-first-async-value). Candidates from triage are marked `fix-easy` in the table. No extract-and-test needed beyond existing coverage; typecheck + quick manual check per screen.

### Phase 3 — wizard/auto-detect chains

**Status: merged (PR #199).**

The `languageTouched` / auto-suggest effect chains shared by `new-session-wizard.tsx`, `text-paste-input.tsx`, `new-adhoc-card-wizard.tsx`. One shared pattern, one PR. Extract the "should auto-apply detection" decision into a pure helper + tests, then move the state writes into the query/event callbacks.

### Phase 4 — queue/recap state machines (extract-and-test)

**Status: merged (PR #201), manually checked.**

`exercise-session-view.tsx`, `session-recap-view.tsx` (and `reading-mode-view.tsx` resets if triage says fixable). Queue-merge logic is partially extracted + tested already; finish the job or conclude the effects are correct and upgrade their suppressions to cite the tests. Manual golden path: composed practice queue with redrills + placeholder swap.

### Phase 5 — external-store subscriptions

**Status: merged (PR #202), manually checked.**

`use-segment-position.ts`, `use-visible-segment-range.ts` → `useSyncExternalStore` per the `no-external-store-subscription` rule, if the ergonomics actually improve. Load-bearing (reading-position resume); manual golden path: resume position + `Last read` pill + deep-link `?segment=` suppression rules per SPEC.

### Phase 6 — revisit permanent suppressions

**Status: done (docs-only close-out PR; no code changes).**

Every surviving suppression was re-read and **confirmed permanent** — the reason comments hold up and no fix was promoted:

- `editable-card-fields.tsx` / `editable-grammar-panel.tsx` — the `lastSavedRef` draft-divergence sync is the correct shape for fields that accept external server writes (chat tool, another tab) while being edited.
- `cefr-per-language-list.tsx` — the "could adopt a `lastSavedRef` guard" idea from triage is **resolved as unnecessary**: the reseed effect's deps are the primitive prop values, so a background refetch returning unchanged values never re-fires it; it fires only on a genuine server-side change (another device, or an error rollback), which is exactly when reseeding the drafts is wanted.
- `session-gloss-sheet.tsx` — SPEC forbids close/reopen (the sheet morphs in place through the save⇄remove toggle and word-swap), so a key-remount rewrite stays off the table; the three re-seed blocks are the stateful-editor pattern.
- `rate-sheet.tsx`, `chat-panel.tsx`, `per-card-chat.tsx`, `extension-pair-view.tsx`, `use-ghost-nomination.ts`, `use-scroll-restoration.ts`, `reading-mode-view.tsx`, and the two debounced language-detect effects (`text-paste-input.tsx`, `new-adhoc-card-wizard.tsx`) — all reactions to transitions, timers, async arrivals, or post-render DOM writes with no event site to move into; each was already confirmed in its phase or carries a self-contained reason.

**Extension decision: do not extend the plugin to `packages/ui` or `apps/extension` for now.** A scan (plugin v1.0.1 recommended, 2026-07-03) found 34 warnings: 30 in `apps/extension` (16 of them in `video-data-sync-dialog.tsx`, a vendored asbplayer-fork dialog) and 6 in `packages/ui` (`floating-sheet.tsx` 4, `use-is-mobile.ts` 2). Reasons:

- `packages/ui` has no ESLint setup at all (no config, no lint script) — enabling one plugin means building the package's lint scaffold first, a separate chore; and `floating-sheet.tsx` is exactly the stateful morphing-sheet pattern that earns permanent suppressions in the web app.
- `apps/extension`'s lint deliberately tolerates legacy-fork warnings (`no-explicit-any` etc. as `warn`, no `--max-warnings 0`), so the zero-warning-baseline discipline this plan depends on cannot hold there; and most of the warnings sit in vendored fork code where minimal divergence from upstream wins (see `EXTENSION-SPEC.md`'s donor-model policy).

Revisit if either surface gains a zero-warning lint baseline.

## Triage table

Filled during PR1. Verdicts: `suppress` (deliberate/load-bearing — reason is in the code), `fix-easy` (phase 2), `fix-pattern` (phase 3), `fix-tested` (phase 4/5).

| file | warnings | verdict | phase | notes |
| --- | --- | --- | --- | --- |
| `features/vocabulary/components/vocabulary-list-view.tsx` | 2 | fix-easy | 2 | **fixed in PR #198** — seed effect deleted; `pickedLanguage ?? languages?.[0]` |
| `features/overlay/components/rate-limiting-overlay-content.tsx` | 1 | fix-easy | 2 | **fixed in PR #198** — `isRetryEnabled` derived as `countdown === 0` |
| `features/sessions/components/new-session-wizard.tsx` | 3 | fix-pattern | 3 | **fixed in PR #199** — prefill derived (`pickedLanguage ?? prefs.lastTargetLanguage`), `languageTouched` deleted |
| `features/sessions/components/text-paste-input.tsx` | 3 | fix-pattern | 3 | **fixed in PR #199** — title suggest moved into the parent's text handler; the debounced detect effect stays with a permanent `no-event-handler` suppression (time-based trigger) |
| `features/vocabulary/components/new-adhoc-card-wizard.tsx` | 2 | fix-pattern | 3 | **fixed in PR #199** — `suggestedCode` mirror replaced by the mutation's `data`/`reset`; detect effect stays, permanent suppression like text-paste. Shared decision helper: `sessions/utils/detected-language.ts` (+ unit tests) |
| `features/practice/components/exercise-session-view.tsx` | 4 | fix-tested | 4 | **fixed in PR #201** — seed effect replaced by a mount-gated `LoadedExerciseSessionView` child (`useState` snapshot seed; both callers set `entries` exactly once); polling interval effect stays (genuine timer); merge logic already extracted + unit-tested (`exercise-queue-merge`) |
| `features/practice/components/session-recap-view.tsx` | 2 | fix-tested | 4 | **fixed in PR #201** — quiz seeds in mount-time `useState` initializers in a `cards && userPrefs`-gated `RecapQuiz` child; term eligibility extracted to `buildRecapTerms` (+ unit tests) |
| `features/practice/components/reading-mode-view.tsx` | 9 | suppress | 4 | **confirmed permanent in PR #201** — key-remount rejected (per-text state spans the article body, the footer's pending ratings, and three sheets); suppression reason made self-contained |
| `features/sessions/hooks/use-segment-position.ts` | 2 | fix-tested | 5 | **fixed in PR #202** — observers wrapped in a `useSyncExternalStore` store keyed on (container, segment); entry classification extracted (`segmentPositionFromEntry` + tests). Small behavior improvement: a new target reads null until first observation instead of flashing the previous target's position |
| `features/sessions/hooks/use-visible-segment-range.ts` | 1 | fix-tested | 5 | **fixed in PR #202** — same store pattern keyed on container (map stays in a ref so the subscription survives list re-derives); min/max extracted (`computeVisibleRange` + tests); snapshot object replaced only on value change (uSES referential-stability requirement) |
| `features/review/components/editable-card-fields.tsx` | 10 | suppress | 6 | editable drafts + `lastSavedRef` divergence sync (chat tool / cross-tab writes) |
| `features/review/components/editable-grammar-panel.tsx` | 1 | suppress | 6 | same draft pattern |
| `features/settings/components/cefr-per-language-list.tsx` | 3 | suppress | 6 | **confirmed permanent (phase 6)** — a `lastSavedRef` guard is unnecessary: primitive-value deps mean the reseed only fires on a genuine server-side change, when reseeding is wanted |
| `features/sessions/components/session-gloss-sheet.tsx` | 11 | suppress | 6 | stateful sheet that morphs in place (SPEC forbids close/reopen); re-seeds per open/selection swap |
| `features/extension-pair/components/extension-pair-view.tsx` | 1 | suppress | — | converging async arrivals (pairing ack + prefs); pairing machinery is trap-prone, leave alone |
| `features/practice/components/rate-sheet.tsx` | 2 | suppress | — | reset-on-close; sheet stays mounted, several close paths |
| `features/review/components/chat-panel.tsx` | 3 (+1 react-refresh) | suppress | — | read-state persistence on open transition + assistant-turn arrival |
| `features/review/components/per-card-chat.tsx` | 1 | suppress | — | seed-job pending→cleared edge from polled status |
| `features/sessions/hooks/use-ghost-nomination.ts` | 4 | suppress | — | debounced scroll settle + server coverage merge; re-requests cost LLM calls |
| `hooks/use-scroll-restoration.ts` | 3 | suppress | — | imperative post-render `scrollTop` write |
| `features/practice/components/flashcard-face.tsx` | 1 react-refresh | suppress | — | co-located pure helper (`poolForCard`) |

Housekeeping fixed in PR1: the `routeTree.gen.ts` ignore pattern didn't match its real path (`src/app/…`) — corrected to `**/routeTree.gen.ts`; `types/hook-types.ts` had a reason-less disable directive.

## Handoff notes

- PR1: #197 (`chore/effect-lint-enable-at-zero`), merged.
- Phase 2: #198 (`chore/effect-lint-phase-2`), merged.
- Phase 3: #199 (`refactor/effect-lint-phase-3`), merged.
- Phase 4: #201 (`refactor/effect-lint-phase-4`), merged.
- Phase 5: #202 (`refactor/effect-lint-phase-5`), merged.
- Phase 6: the docs-only close-out PR that archived this doc. Plan complete — nothing further is planned.
- Scan reproduction: `pnpm --filter @flicktionary/web lint` (the plugin is enabled; the lint script carries `--max-warnings 0`).
- Nothing in phases 2+ should start before PR1 merges — the suppression comments are the shared triage record.
- When a phase PR removes an effect, delete its suppression in the same commit (`reportUnusedDisableDirectives: 'error'` fails the lint otherwise) and update this doc's phase status + triage-table row.
