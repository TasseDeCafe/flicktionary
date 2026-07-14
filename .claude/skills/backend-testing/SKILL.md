---
name: backend-testing
description: Conventions for backend unit and integration tests in apps/backend — the shared never-reset test database, per-test unique fixtures, injected LLM mocks, seeding through the API, and the run commands. Use whenever writing, extending, or running backend tests.
---

Two kinds of backend tests, split by filename and picked up by pattern in `apps/backend/vitest.config.mts`:

- `*.unit.test.ts` — pure logic. The dominant style extracts pure functions and feeds them hand-built row objects; LLM prompt/parser code is unit-tested against static strings. No mocking framework for vendor APIs.
- `*.integration.test.ts` — run against the local `supabase-test` stack (ports 64xxx): repository SQL tests, and router tests driving `buildApp` over HTTP with supertest.

## When to add which

Do this by default when shipping backend changes, don't wait to be asked:

- Pure logic (schedulers, parsers, mappers) → unit test, as usual.
- New or changed repository SQL → an integration test for that repository ships with the change.
- New or changed oRPC surface → extend (or add) that router's golden-path integration test: supertest through `buildApp`, golden path + a 401 + one domain failure. Not exhaustive scenarios — those stay in unit tests. Canonical pattern: `apps/backend/src/router/glosses-router/glosses-router.integration.test.ts`. Routers still untested over HTTP get a test when their surface next changes, not as a sweep.

## Conventions

The suite runs test files in parallel against one shared, **never-reset** database, so:

- Every test creates its own unique users/rows via the helpers in `src/test/test-utils.ts` (unique emails by default). Never hardcode an email, never wipe tables or auth users globally, and anything you assert on must be keyed by a per-test unique value (no whole-table counts).
- LLM calls are injected: pass `MockAnthropicPasses({ ...scripted pass outputs })` through `buildApp` / `ProcessingDependencies`. Never `vi.mock` a vendor client module.
- Seed through the API where a synchronous flow exists (e.g. `/cards/adhoc` is how practice tests get a kept term); use repos directly only for prefs-style setup.

## Running

`pnpm --filter @flicktionary/backend test:integration:run [file...]` starts the stack and runs the tests (arguments are forwarded to vitest, so single-file runs go through the same script). A vitest globalSetup applies pending migrations to the supabase-test stack before every non-unit run — including the pre-push hook's `vitest run` and direct single-file invocations — so a freshly created migration cannot leave the test schema behind. The stack itself must be running for integration tests (`pnpm --filter @flicktionary/backend db:test` if it isn't).

## CI

`.github/workflows/backend-ci.yaml` runs on pushes to `main` only, as a non-blocking tripwire for what pre-push structurally can't test — the server-side merge commit and clean-machine effects. Two jobs: the full backend suite against a fresh supabase-test stack, and a deploy smoke test that builds with Railway's exact build command and boots the compiled server from the fresh clone (catches the transitive-dep `ERR_MODULE_NOT_FOUND` class — see the `remove-dead-code` skill). Pre-push remains the primary gate; a red CI run on `main` means the merge result differs from what was tested locally.
