# Plan: catch production-only runtime dep failures in pre-push

> **Status: proposal — not implemented.** An open design for a future safeguard;
> nothing here ships today. Implement only when explicitly picked up.

## The bug this is meant to catch

On 2026-05-27 a Railway deploy of `apps/backend` crashed at startup:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@orpc/contract'
imported from /app/apps/backend/dist/packages/api-client/src/orpc-contracts/authentication-contract.js
```

### Root cause

The backend prod build (`apps/backend/scripts/build--prod.sh` → `tsc --project tsconfig.prod.json` + `tsc-alias`) uses **TS project references**. It compiles the referenced workspace packages — `@flicktionary/api-client` and `@flicktionary/core` — into `apps/backend/dist/packages/**`. Those emitted `.js` files keep their original bare `import`s (e.g. `import { oc } from '@orpc/contract'`).

That means **every _runtime_ dependency of api-client / core must also be a direct dependency of `apps/backend`**, because at deploy time the bundled code resolves those imports from `apps/backend`'s own `node_modules`. `@orpc/contract` is declared in `packages/api-client/package.json` but was removed from `apps/backend/package.json` during a knip dead-code cleanup — nothing in `apps/backend/src` imports it directly, so it looked unused.

### Why every local check passed

| Check | Why it didn't catch it |
| --- | --- |
| `grep apps/backend/src` | `@orpc/contract` is imported by api-client, not backend source. |
| `knip` | Doesn't trace transitive runtime deps of bundled workspace packages. |
| `tsc` / `check:types` | Resolves through the **hoisted workspace `node_modules`**, where the package exists regardless of what backend declares. |
| `build` | Compiles only; never executes the artifact. |
| `test:run` | Runs under the full workspace install, same hoisting. |

The failure is a **runtime ESM resolution error under an isolated production install**. Railway installs only `apps/backend`'s declared deps, so the hoisting that masks it locally doesn't exist there.

**Key insight:** to catch this locally we must reproduce *dependency isolation* — not just run the built server (running it from the workspace would still resolve via hoisting and pass).

## Proposed check (Option B): isolated deploy + boot smoke-test

After the backend builds, produce an isolated production install and actually boot the compiled server inside it.

### Steps

1. **Gate on backend being affected.** The pre-push already computes `turbo ls --affected --output=json`. Only run this check when `@flicktionary/backend` is in the affected set, to keep pushes that don't touch the backend fast.
2. **Build** the backend prod artifact (already happens in the hook via `pnpm build`).
3. **Isolated install** into a temp dir:
   ```
   pnpm --filter @flicktionary/backend deploy --prod <tmpdir>
   ```
   `pnpm deploy` resolves the **production dependency tree of `apps/backend` alone** into `<tmpdir>/node_modules` — the same model Railway uses. This is the load-bearing step: it strips away workspace hoisting.
4. **Boot smoke-test:** start the compiled entrypoint from inside `<tmpdir>` with production-like env, wait for a readiness signal, then shut it down:
   - Spawn `node <tmpdir>/dist/<entry>.js` (confirm the real entry path; the error shows `dist/...`).
   - Success = process stays up past a short timeout **or** a `GET /health`/`/healthz` (confirm the route exists) returns 2xx.
   - Failure = process exits non-zero (e.g. `ERR_MODULE_NOT_FOUND`) → fail the push with the captured stderr.
   - Always kill the child and clean `<tmpdir>` in a trap.

### How to test it catches this class

Reproduce the original bug and confirm the check fails:

1. Remove `"@orpc/contract": "catalog:"` from `apps/backend/package.json`, run `pnpm install`.
2. Run the pre-push (or the check script directly).
3. **Expected:** build still passes, but the boot smoke-test fails with `ERR_MODULE_NOT_FOUND: Cannot find package '@orpc/contract'`.
4. Restore the dep → check passes again.

This regression test should live alongside the check (e.g. a documented manual step here, or an automated test that scripts the remove/restore).

## Open questions / decisions

- **Entry path & readiness signal.** Confirm the compiled entrypoint path and whether there's a health endpoint to poll, or whether "survives N seconds without crashing" is enough. A crash-on-import like this one fails immediately, so even a short liveness window catches it.
- **Env / secrets.** The server needs enough env to *start* without reaching out to real services. Options: a minimal fake env, or rely on the `FEATURES.*` flags (Sentry/PostHog/Stripe off) + relaxed schema so startup doesn't require live credentials. Must not depend on Doppler/network in pre-push.
- **DB / Supabase.** If startup opens a DB connection, decide whether to point at the local dev-tunnel, stub it, or restructure so import-time resolution is validated without a live DB. The import-resolution failure happens before any DB call, so a check that fails fast on import errors may not need a DB at all.
- **Cost.** `pnpm deploy` does a production install each run (seconds–tens of seconds). Gating on backend-affected keeps it off most pushes. If still too slow, consider moving it to CI and keeping only a fast static check (Option A) in the hook.
- **Cross-check with Railway config.** Verify `pnpm deploy --prod` matches how Railway actually installs (`railway.toml` / Nixpacks / Dockerfile) so the isolation faithfully mirrors prod.

## Cheaper always-on companion (Option A, optional)

A static lint that scans `apps/backend/dist/**` for bare import specifiers and asserts each is a Node builtin or listed in `apps/backend/package.json` dependencies. Near-instant, deterministic, catches exactly this bug — but misses dynamic imports and ESM/CJS interop issues that the boot test would catch. Could run on every push as a fast tripwire, with Option B gated on backend-affected.

## Deeper alternative (out of scope here)

Bundle the backend with esbuild/tsup so workspace deps are **inlined** into `dist` (no runtime resolution of transitive deps). Then `dist` is self-contained and this entire failure class disappears — at the cost of a build-tooling change.
