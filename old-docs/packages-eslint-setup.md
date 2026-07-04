# ESLint for the workspace packages

> **Status: historical** (archived 2026-07-04). Implemented as designed: `packages/eslint-config` exports the `base` / `react` presets, and `ui` / `core` / `api-client` / `i18n` are wired with zero-warning lint scripts. One divergence: the preset owns the plugin dependencies itself (its config files `require()` them, so Node resolves from the preset's `node_modules`) — consumers only need `eslint` + the preset. The `apps/web` `lint:check --max-warnings 0` rider from the open questions was applied too.

## Motivation

- `packages/ui` is shared React code consumed by both `apps/web` and `apps/extension` — the widest blast radius in the repo — yet it has **no ESLint at all** (no config, no script; only `check:types`). Every convention the apps enforce (effect discipline, unused vars, the no-`function`-keyword rule, prettier shape) stops at the package boundary.
- `packages/i18n` has an `eslint.config.cjs` but **no lint script**, so it never runs outside the IDE — a dead config.
- The enforcement plumbing already exists and silently skips packages today: the pre-commit hook runs `lint-staged`, which discovers the per-workspace `lint-staged` config nearest each staged file (packages have none → staged package files are never linted); the pre-push hook runs `pnpm lint:check` = `turbo run lint:check` (packages have no script → skipped).
- The effect-lint plan (`old-docs/add-eslint-effect.md`, phase 6) deferred `eslint-plugin-react-you-might-not-need-an-effect` on `packages/ui` with "revisit if the surface gains a zero-warning lint baseline". This proposal is that baseline.

## Current state

| workspace | React | eslint config | lint script |
| --- | --- | --- | --- |
| `packages/ui` | yes | none | none |
| `packages/core` | no (plain TS + DOM utils) | none | none |
| `packages/api-client` | no (oRPC contracts) | none | none |
| `packages/i18n` | no | `eslint.config.cjs`, unwired | none |
| `packages/typescript-config` | — (json presets only) | out of scope | — |

All plugin versions needed are already in the pnpm catalog (`pnpm-workspace.yaml`); no new third-party deps.

## Design

### 1. A `packages/eslint-config` preset package

Precedent: `packages/typescript-config` (shared tsconfig presets consumed via `extends`). The new package exports two flat-config arrays, CJS to match the existing `eslint.config.cjs` convention:

- **`base`** — for plain-TS packages. `@typescript-eslint` parser + recommended rules, `no-unused-vars` tuned as in `apps/web` (`args: 'none'`, `caughtErrors: 'none'`), the repo prettier rule (trailing commas es5, single quotes, no semi, printWidth 120), `no-restricted-syntax` banning `function` declarations, plus the suppression-hygiene pair from the web rollout: `reportUnusedDisableDirectives: 'error'` and `@eslint-community/eslint-comments/require-description`.
- **`react`** — `base` + `eslint-plugin-react-you-might-not-need-an-effect` (recommended) + `eslint-plugin-lingui` (flat/recommended; `packages/ui` carries user-facing copy) + the tailwindcss prettier plugin (ui components are Tailwind-styled).

Deliberately **not** included:

- `eslint-plugin-react-refresh` — Fast Refresh is a consumer-bundler concern, and ui's shadcn-style multi-export files would all need the same exception `apps/web` already scopes off for `src/components/ui/**`.
- `@tanstack/eslint-plugin-query` — packages don't own query hooks; data flows in via props.

### 2. Per-package wiring

Each of `ui`, `core`, `api-client`, `i18n` gets:

- `eslint.config.cjs` spreading the preset (`react` for ui, `base` for the rest) plus package-local `ignores` (`dist`, and `locales/**` for i18n).
- Scripts: `"lint": "eslint . --fix --max-warnings 0"`, `"lint:check": "eslint . --max-warnings 0"`.
- A `lint-staged` block (`"*.{ts,tsx}": "eslint --fix"`).
- devDeps: `eslint` + `@flicktionary/eslint-config` (+ the preset's plugins, since flat config resolves plugins from the consuming package — mirror how `apps/web` lists them).

`packages/i18n`'s existing hand-rolled config is deleted in favor of the preset (it is a strict subset of `base`).

No Turbo or hook changes needed: `lint` / `lint:check` tasks already exist in `turbo.json`, so root `pnpm lint`, the pre-push gate, and pre-commit `lint-staged` all pick the packages up the moment the scripts exist.

### 3. Zero-warning baseline from day one

Same discipline as the `apps/web` effect-lint rollout: `--max-warnings 0`, every suppression carries a `-- reason`, stale directives fail. The packages are all Flicktionary-authored (no vendored fork code), so a zero baseline is achievable immediately — this is what makes them different from `apps/extension`, where the decision not to enable the effect plugin stands (see `old-docs/add-eslint-effect.md`).

Expected initial triage (scan 2026-07-03):

- `packages/ui` — 4 effect-plugin warnings, all in `floating-sheet.tsx`: the stateful morphing-sheet pattern that earned permanent reasoned suppressions in the web app (`session-gloss-sheet.tsx`); expect the same verdict, not fixes. (`use-is-mobile.ts`'s 2 warnings were already fixed via `useSyncExternalStore`.) Lingui-plugin findings unknown until the first scan — triage them in the PR.
- `core` / `api-client` / `i18n` — plain-TS recommended rules over code that already typechecks strict; expect near-zero, and anything found is either real or trivially fixable.

## Out of scope

- Migrating the apps' configs onto the preset. Worthwhile follow-up — `web` / `backend` / `extension` / `native` each hand-roll the same base rules — but each app has local particulars (extension's legacy-fork `warn` downgrades must not leak into the preset), so it's a separate chore per app.
- Enabling the effect plugin in `apps/extension` (decision record stands).
- A CI lint job (none exists today; enforcement is the pre-push hook).

## Open questions

- Should the apps' `lint:check` scripts also gain `--max-warnings 0`? Today only `apps/web`'s `lint` (not `lint:check`) carries it, so the pre-push gate does not actually enforce the web zero-warning baseline — warnings exit 0. The packages' scripts will carry it on both; aligning `apps/web` is a one-line candidate rider.
- Whether `eslint-plugin-lingui`'s recommended set is too noisy for ui's mixed copy/plumbing strings — decide from the first scan; drop the plugin rather than tolerate suppression noise (per the effect-lint plan's "disable chronically noisy rules" rule).

## Estimated size

One PR: the preset package + four package wirings + the initial suppression/fix triage.
