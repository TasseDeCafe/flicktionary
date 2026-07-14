---
name: remove-dead-code
description: Finds and removes dead code with knip (unused files, exports, dependencies) while avoiding this repo's known false positives and the bundled-workspace-dependency trap. Use whenever running knip, hunting for dead code, or removing unused exports or dependencies.
---

`pnpm knip` (from the root) reports unused files, exports, and dependencies across the workspaces. It is a static analyzer, so treat its output as candidates, not facts. Config lives in `knip.json`.

Rules:

- **`apps/native` is excluded** (`ignoreWorkspaces` in `knip.json`) because it isn't wired up yet. Until native is set up correctly, run knip **scoped to a single ready workspace** — `pnpm knip --workspace apps/backend` or `pnpm knip --workspace apps/web` — rather than the unscoped `pnpm knip`. The unscoped run reports `Unused catalog entries` noise (catalog deps consumed only by the ignored native app) that is not actionable.
- **Always ask the user for permission before deleting anything knip flags.** Never remove "dead" code unattended. Also check `DISABLED.md` and `packages/core/src/features.tsx` first — this repo is a trimmed SaaS template, and "unused" code may be deliberately parked machinery.
- Verify each candidate first: `grep` the symbol/file repo-wide, and check whether an export flagged as unused is still used _within its own file_ (then only drop the `export` keyword, don't delete the symbol).
- Known false positives — do NOT remove:
  - shadcn/ui re-exports under `apps/web/src/components/ui/**` (e.g. `DialogClose`, `buttonVariants`) are kept as a deliberate API surface.
  - generated files like `routeTree.gen.ts` (TanStack Router).
  - dependencies consumed indirectly: `prettier`/`prettier-plugin-tailwindcss` (via `eslint-plugin-prettier` in `eslint.config.cjs`), and anything invoked only from config files or root orchestration.
  - **transitive runtime deps of bundled workspace packages.** The backend prod build (`scripts/build--prod.sh`, TS project references) compiles `@flicktionary/api-client` and `@flicktionary/core` into `apps/backend/dist/packages/**`. Those bundled files keep their own `import`s, so every _runtime_ dep of api-client/core must ALSO be a direct `apps/backend` dependency (e.g. `@orpc/contract`, `zod`) — even though nothing in `apps/backend/src` imports them. Removing one passes typecheck/build/tests locally (resolved via hoisted workspace `node_modules`) but throws `ERR_MODULE_NOT_FOUND` at runtime on Railway, where only `apps/backend`'s own deps are installed. Before removing any backend dep, cross-check `packages/api-client/src` and `packages/core/src` imports. The `deploy-smoke` CI job (`.github/workflows/backend-ci.yaml`) boots the compiled artifact from a fresh clone and catches this class post-merge — a tripwire, not a license to skip the cross-check.
- The "Unused dependencies" category is the least reliable — prefer surgical, verified removals over bulk deletes, and re-run `pnpm install` afterward to sync the lockfile.
- When knip is wrong about an entry point or generated file, teach it via `knip.json` rather than deleting working code.
