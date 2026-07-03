# Effect-lint cleanup (eslint-plugin-react-you-might-not-need-an-effect)

> **Status: proposal.** Multi-PR cleanup plan, tracked here for cross-thread handoff. Phase statuses below are the source of truth for where the work stands; never treat the phase list as shipped behavior.

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

**Status: implemented on `chore/effect-lint-enable-at-zero`, PR open — merge pending.**

- Bump catalog `eslint-plugin-react-you-might-not-need-an-effect` 0.9.2 → 1.0.1.
- Add `@eslint-community/eslint-plugin-eslint-comments` (catalog + `apps/web` devDep).
- Enable the plugin's `recommended` config in `apps/web/eslint.config.cjs`; add `reportUnusedDisableDirectives: 'error'` + `require-description`.
- Add `--max-warnings 0` to the `apps/web` lint script.
- Suppress **every** warning with a reasoned `-- <why>` — including apparent true positives. PR1 is strictly zero behavior change; fixes happen in the phase PRs so each is individually revertable and testable.
- Fill the triage table below while reading each effect.
- Fix/suppress the 2 pre-existing react-refresh warnings.

### Phase 2 — trivial true positives

**Status: not started.**

Effects whose removal is a local, low-risk rewrite (derived state, seed-first-async-value). Candidates from triage are marked `fix-easy` in the table. No extract-and-test needed beyond existing coverage; typecheck + quick manual check per screen.

### Phase 3 — wizard/auto-detect chains

**Status: not started.**

The `languageTouched` / auto-suggest effect chains shared by `new-session-wizard.tsx`, `text-paste-input.tsx`, `new-adhoc-card-wizard.tsx`. One shared pattern, one PR. Extract the "should auto-apply detection" decision into a pure helper + tests, then move the state writes into the query/event callbacks.

### Phase 4 — queue/recap state machines (extract-and-test)

**Status: not started.**

`exercise-session-view.tsx`, `session-recap-view.tsx` (and `reading-mode-view.tsx` resets if triage says fixable). Queue-merge logic is partially extracted + tested already; finish the job or conclude the effects are correct and upgrade their suppressions to cite the tests. Manual golden path: composed practice queue with redrills + placeholder swap.

### Phase 5 — external-store subscriptions

**Status: not started.**

`use-segment-position.ts`, `use-visible-segment-range.ts` → `useSyncExternalStore` per the `no-external-store-subscription` rule, if the ergonomics actually improve. Load-bearing (reading-position resume); manual golden path: resume position + `Last read` pill + deep-link `?segment=` suppression rules per SPEC.

### Phase 6 — revisit permanent suppressions

**Status: not started.**

After phases 2–5, re-read the remaining suppressions (expected survivors: `editable-card-fields.tsx` server→draft sync, `session-gloss-sheet.tsx` reset-on-open cluster, `use-scroll-restoration.ts`, chat open/read effects). Either confirm them as permanent (reason comments already say why) or promote newly-obvious fixes. Also decide whether to extend the plugin to `packages/ui` and `apps/extension` (54 more effect call sites, unscanned).

## Triage table

Filled during PR1. Verdicts: `suppress` (deliberate/load-bearing — reason is in the code), `fix-easy` (phase 2), `fix-pattern` (phase 3), `fix-tested` (phase 4/5).

| file | warnings | verdict | phase | notes |
| --- | --- | --- | --- | --- |
| `features/vocabulary/components/vocabulary-list-view.tsx` | 2 | fix-easy | 2 | `selectedLanguage ?? languages?.[0]` deletes the seed effect |
| `features/overlay/components/rate-limiting-overlay-content.tsx` | 1 | fix-easy | 2 | `isRetryEnabled` is `countdown === 0` |
| `features/sessions/components/new-session-wizard.tsx` | 3 | fix-pattern | 3 | prefs-MRU prefill; derive with the touched-flag override |
| `features/sessions/components/text-paste-input.tsx` | 3 | fix-pattern | 3 | title auto-suggest can move into the parent's `setText`; the debounced language-detect effect likely stays (time-based trigger) |
| `features/vocabulary/components/new-adhoc-card-wizard.tsx` | 2 | fix-pattern | 3 | same debounced-detect shape as text-paste |
| `features/practice/components/exercise-session-view.tsx` | 4 | suppress | 4 | queue = one-shot snapshot, polls mutate it in place; merge logic already extracted + unit-tested (`exercise-queue-merge`) |
| `features/practice/components/session-recap-view.tsx` | 2 | suppress | 4 | one-shot seed once cards + prefs land; rebuild mid-quiz is forbidden |
| `features/practice/components/reading-mode-view.tsx` | 9 | suppress | 4 | per-text UI reset keyed on text id; key-remount of the per-text subtree is the candidate refactor |
| `features/sessions/hooks/use-segment-position.ts` | 2 | fix-tested | 5 | IO+MO subscription → `useSyncExternalStore` candidate |
| `features/sessions/hooks/use-visible-segment-range.ts` | 1 | fix-tested | 5 | same family; feeds resume-position persistence — golden path required |
| `features/review/components/editable-card-fields.tsx` | 10 | suppress | 6 | editable drafts + `lastSavedRef` divergence sync (chat tool / cross-tab writes) |
| `features/review/components/editable-grammar-panel.tsx` | 1 | suppress | 6 | same draft pattern |
| `features/settings/components/cefr-per-language-list.tsx` | 3 | suppress | 6 | drafts re-seeded from server row; has no `lastSavedRef` guard — could adopt one in phase 6 |
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

- PR1 branch: `chore/effect-lint-enable-at-zero`.
- Scan reproduction: `pnpm --filter @flicktionary/web lint` (the plugin is enabled; the lint script carries `--max-warnings 0`).
- Nothing in phases 2+ should start before PR1 merges — the suppression comments are the shared triage record.
- When a phase PR removes an effect, delete its suppression in the same commit (`reportUnusedDisableDirectives: 'error'` fails the lint otherwise) and update this doc's phase status + triage-table row.
