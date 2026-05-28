# Extension Typecheck Debt

## Context

`packages/extension` and `packages/asbplayer-common` were imported from the asbplayer fork. The extension builds successfully through WXT, but a raw TypeScript check with:

```bash
pnpm --filter @flicktionary/extension run compile
```

still reports many errors from the vendored asbplayer code and from fork integration drift.

To keep PRs moving, `packages/extension` currently uses the WXT production build as its `check:types` gate. This matches the actual extension bundling path and lets the root pre-push hook pass:

```bash
pnpm check:types
```

## Current Compromise

- `pnpm --filter @flicktionary/extension run check` passes.
- `pnpm check:types` passes.
- `pnpm --filter @flicktionary/extension run compile` is intentionally stricter and still fails.

This is acceptable short term because WXT/Vite can resolve and bundle the extension, while plain `tsc --noEmit` currently typechecks a large amount of inherited fork code that was not imported in a type-clean state.

## Cleanup Tasks

1. Make module resolution consistent for strict TypeScript.
   - Keep `tsconfig.json` path aliases aligned with `wxt.config.ts`.
   - Confirm subpath imports such as `@asbplayer-fork/common/settings` resolve under plain `tsc`.

2. Decide the long-term strictness boundary.
   - Option A: make the full vendored asbplayer fork type-clean.
   - Option B: keep the fork as build-checked vendor code and typecheck only Flicktionary-owned integration modules strictly.

3. Fix the remaining strict TypeScript errors if choosing Option A.
   - Missing or drifted exports from `@asbplayer-fork/common`.
   - `DisplaySubtitleModel` shape mismatches.
   - `SubtitleColoring.subtitlesAt` API drift.
   - Implicit `any` parameters in copied fork code.
   - Unknown/object typing around dictionary and subtitle-coloring paths.

4. Revisit package boundaries.
   - Move reusable Flicktionary-specific logic out of the asbplayer fork and into existing Flicktionary packages when it becomes stable.
   - Keep auth/session/token storage outside asbplayer settings.

5. Restore a stricter extension type gate when practical.
   - Target end state: `pnpm --filter @flicktionary/extension run compile` passes.
   - Then change `packages/extension` `check:types` back from `pnpm run build` to `tsc --noEmit` or another strict TypeScript command.

## Verification Commands

Current PR gate:

```bash
pnpm check:types
pnpm --filter @flicktionary/extension run check
```

Future cleanup target:

```bash
pnpm --filter @flicktionary/extension run compile
```
