This turborepo monorepo is the repo of Flicktionary.app. This is a work in progress, don't treat it like a polished product.

The product spec is `SPEC.md` — the overview (what the app is, terminology, per-area summaries, navigation/settings, LLM methodology, user flows). The deep web-app behavior specs are split per area: `docs/READER-SPEC.md`, `docs/REVIEW-SPEC.md`, `docs/SRS.md`, `docs/DATA-MODEL.md`. None of them are auto-loaded; read the relevant one before working in its area. The browser extension (`apps/extension`, a vendored asbplayer fork) has its own dedicated spec: `apps/extension/EXTENSION-SPEC.md` — the source of truth for extension behavior, architecture, fork lineage, and the do-not-reintroduce/donor-model policy. Read it before working on the extension. See the **Project docs map** below for the full set of docs and what each one owns.

Keeping the docs honest: the behavior specs are meant to match the code. If you notice drift, or you make a change that needs a spec update, do it **as part of shipping that change** — running the `create-pr` or `update-docs` skill is your green light to edit the behavior specs (`SPEC.md`, `docs/READER-SPEC.md`, `docs/REVIEW-SPEC.md`, `docs/SRS.md`, `docs/DATA-MODEL.md`, `apps/extension/EXTENSION-SPEC.md`). Outside that flow, don't rewrite a spec unprompted mid-conversation — surface the drift and let me confirm. Never edit the reference/artifact docs (see the map) to "keep them current"; they don't track the code.

# Project docs map

Where the documentation lives and how much to trust each piece. When in doubt about "which doc is authoritative for X", this is the answer.

**Behavior specs** — authoritative, and they track the code. Read the relevant one before working in its area; update it (in place — these are not changelogs) when you change what it describes, via the `create-pr` / `update-docs` flow.

- `SPEC.md` — the product overview: what the app is/isn't, terminology, per-area summaries + pointers, navigation/settings, LLM methodology prompt, user flows. Not auto-loaded. Deep behavior lives in the per-area specs below — update those, not the summaries, when behavior changes.
- `docs/READER-SPEC.md` — sources (movie/TV/text/ad-hoc ingestion), the in-session reader (gloss sheet, highlights, ghost suggestions), the background enrichment pipeline, tap-to-translate. **Read before touching source wizards, the reader, or the pipeline.**
- `docs/REVIEW-SPEC.md` — the two-layer review UI: session-vocabulary list + focus view (card editing, provenance, study targets, per-card chat, session recap). **Read before touching either layer.**
- `docs/SRS.md` — the **single home for the practice / spaced-repetition system** (web): scheduler, queues, study facets, leeches/warm-up, daily budgets, reading mode, exercise bank, and the practice UI surfaces. **Read before touching practice behavior.**
- `docs/DATA-MODEL.md` — the annotated core schema + card content tiers (basic data, grammar bag, exploration extras, export front/back). **Read before schema or card-shape work.**
- `apps/extension/EXTENSION-SPEC.md` — the browser extension: behavior, architecture, fork lineage, removed-subsystem & donor-model policy. **Read before any extension work.**
- `AGENTS.md` (this file) — conventions, stack, commands, and hard-won traps.

**Reference / artifact docs** — authoritative for their subject but **not** code-driven. Do **not** edit them to "stay current"; touch one only when its specific subject actually changes.

- `docs/DOPPLER_CLI.md` — a verbatim copy of Doppler's own CLI docs. Vendored reference; never rewrite.
- `apps/extension/CHROME-WEB-STORE-LISTING.md` — canonical Chrome Web Store listing copy (edit only when the listing changes; note the keyword-spam policy inside).
- `apps/extension/AMO-LISTING.md` — canonical Firefox Add-ons (AMO) submission copy: listing summary, the privacy-policy plain-text mirror, and the source-build reviewer notes (edit only when the listing changes).
- `DISABLED.md` — log of parked/disabled template machinery; check it before deleting "unused" code.
- READMEs (`apps/web/README.md`, `apps/backend/README.md`, `apps/backend/src/transport/database/README.md`, and other scoped `**/README.md`) — local how-tos for one area. Update only if you change the thing they document.

**Proposals** — `docs/proposals/` holds open designs not yet implemented (e.g. `prompt-caching-optimization.md`, `chat-generate-form-facets.md`) and post-MVP backlog/idea lists (e.g. `web-future-ideas-and-open-questions.md`). Useful context; **never** treat as current behavior.

**Scratch** — `docs/brand/` holds brand-asset generation prompts (`LOGO-PROMPTS.md`, `IMAGE-PROMPTS.md`). Not specs; ignore when reasoning about app behavior.

**Historical** — `old-docs/` is the archive: superseded plans and the former running build-log (`RESUME.md`). Kept for history only. **Never** read these as current-state reference and never update them.

Creating or relocating a doc? Follow the `writing-docs` skill (labels, locations, when to archive).

The following stack is used:

- Web: TypeScript React single-page application built with Vite.
- Backend: TypeScript on Node.js backend with Express framework.
- Native: Typescript Expo-managed React Native app with Expo Router.
- Database: Supabase database without an ORM, writing queries directly in the code with Postgres.js as the PostGresSQL client.

Some of the main third-party dependencies:
Data fetching: React Query (web and native only)
Shared API library: oRPC.
State management: Zustand.
i18n: Lingui JS.
Testing: Vitest.
Routing: TanStack Router.

The template is built so that it's easy to deploy this stack, and also have useful features like:

- Authentication (Supabase): Magic link, Google, Apple.
- Payments with Stripe (web) and RevenueCat (native)
- Marketing/Transactional emails with Resend
- Error monitoring with Sentry
- Analytics with Posthog
- Doppler for secrets management and injection.

Not all those features are enable. See packages/core/src/features.tsx for the list of enable features. Also see DISABLED.md

# Conventions:

TS across all the apps: web, backend, native. It's important for you to follow those conventions:

- use const for functions, don't use the "function" keyword
- use ESM when possible.

Here are the prettier rules for code formatting:

- Trailing Commas: Use trailing commas wherever they are valid in ES5 (e.g., in objects, arrays).
- Quotes: Use single quotes for all strings.
- JSX Quotes: Use single quotes for JSX attributes.
- Semicolons: Do not use semicolons at the end of statements.

For our react code style:

- Never import React
  do not do:
  `export const ProgressView: React.FC = () => {`
  just do:
  `export const ProgressView = () => {`

# General guidelines for your answers:

- If you think that a critical file or some context is missing, try to find it yourself, or ask for it to the user.
- Try not to apply "band-aid" solutions: try to fix the root cause of the problem.
- Do not hesitate to refactor the code if it fixes the root cause or simplify the code without changing the functionality.
- Do not write code that is backwards compatible unless explicitly asked to do so. Assume that the code is a greenfield project.
- If you find any vestigial, dead, legacy code that can be safely removed while executing a task, you can mention it in your message at the end of the task. It doesn't need to be related to the task.
- If you find any code that can be refactored with a big impact, mention it in your message at the end of a task. It can be renaming for clarity, a simplification, improving reusability, etc. It doesn't need to be related to the task.

## Localization pattern (Lingui)

- Default to Lingui for every user-facing text. Never ship raw strings; wrap them with `t`` template literals as soon as you add copy.
- In React components or hooks, import `useLingui` and call it near the top (`const { t, i18n } = useLingui()`). Use `t``Text`` in JSX/TS, and call `i18n.\_(messageDescriptor)`for shared descriptor maps like`langNameMessages`.
- Outside React (e.g., config files, query meta, utility modules), import `{ t }` from `@lingui/macro` and, when needed, the shared `i18n` instance for lookups. Keep text in template literals so translators see the full sentence.
- When interpolating values, assign them to descriptive variables and reference them inside the template literal (`const savedCount = ...; t`You saved ${savedCount} phrases``). Avoid string concatenation or unnamed `${expression}` chains.
- Do not set custom ids when calling `t`. The English source string remains the id so extraction keeps working without manual bookkeeping.
- Do NOT translate new strings manually. Catalogs are filled by an AI translation script with less context than you have, and that's accepted — just add the English copy in `t`` template literals and leave the catalogs alone. Translation runs at **PR time**, not on every push: the `create-pr` flow runs `pnpm translate:sync` (extract → AI-translate the missing entries → re-extract to normalize the catalog format) and commits `packages/i18n/locales` alongside the code. To do it by hand, run `pnpm translate:sync` yourself. The pre-push hook no longer translates — it's a fast deterministic **guard**: it runs `pnpm lingui extract --clean`, then fails the push if that changed the catalogs (stale) or if any string is still untranslated (`pnpm translate:check`), telling you to run `pnpm translate:sync`. This keeps "you can't push untranslated strings" without the slow AI call, the auto-commit, or the "push again" dance the old hook forced.

## oRPC + TanStack Query

The web/native apps consume the contract through `@orpc/tanstack-query`'s `createTanstackQueryUtils(...)` (exposed as `orpcQuery`). Two helpers look interchangeable but aren't:

- `orpcQuery.path.method.key(...)` — returns a **partial / prefix** key. Use it for `invalidateQueries` and `cancelQueries`, where prefix matching is the point. `.key()` (no arg) matches every variation; `.key({ input })` narrows the prefix but still uses prefix semantics.
- `orpcQuery.path.method.queryKey({ input })` — returns the **exact full** key including input. Required by `setQueryData` / `getQueryData`, which look up an entry by exact match. Passing a `.key(...)` result here silently no-ops (writes go nowhere; reads return undefined), and the symptom is "the cache won't update / the UI keeps showing stale data after a successful mutation."

Rule of thumb: if you're invalidating, use `.key(...)`. If you're reading or writing the cache directly, use `.queryKey({ input })`. See `apps/web/src/features/review/api/card-cache.ts` for the canonical setQueryData pattern.

Backend oRPC handlers should return DTOs that already match the contract exactly. In particular, normalize `TIMESTAMP WITH TIME ZONE` / `timestamptz` values from Postgres.js to ISO strings in router mappers with `toIsoString` from `apps/backend/src/router/router-utils.ts` instead of relying on JSON serialization to coerce `Date` objects after output validation.

# Web UI patterns

The web app follows opinionated UI idioms (hover/press states, `WizardShell`, sticky CTAs, `OptionCard`, language pickers, mobile inputs, overlay sizing, and loading-state skeletons). When adding or editing a view, card, row, modal, form, or loading state, follow the **`web-ui-patterns` skill** — it holds the canonical examples and the rules to mirror.

# Useful commands:

- Check typing with TS: pnpm check:types (executed from the root directory)
- Check linting with ESLint: pnpm lint (executed from the root directory)
- Find dead code (unused files / exports / dependencies): pnpm knip (from the root). Scope to one workspace with `pnpm knip --workspace apps/web`. Config lives in `knip.json`.
- Time-travel practice data (test multi-day SRS flows like the 3-day warm-up/rehab graduation without waiting): `pnpm db:advance-day [--days N] [--email <email>]` from the root shifts every practice timestamp in the dev-tunnel DB backward — equivalent to the server day advancing, because all day logic compares stored values against Postgres `NOW()`/`CURRENT_DATE`. The same shift, scoped to your own account and usable in any environment, is the "Practice time travel" card in the web app's admin settings (test users only). Core logic: `apps/backend/src/transport/database/dev-tools/shift-practice-timestamps.ts`.

# Finding and removing dead code (knip)

`pnpm knip` reports unused files, exports, and dependencies across the workspaces. It is a static analyzer, so treat its output as candidates, not facts.

Rules:

- **`apps/native` is excluded** (`ignoreWorkspaces` in `knip.json`) because it isn't wired up yet. Until native is set up correctly, run knip **scoped to a single ready workspace** — `pnpm knip --workspace apps/backend` or `pnpm knip --workspace apps/web` — rather than the unscoped `pnpm knip`. The unscoped run reports `Unused catalog entries` noise (catalog deps consumed only by the ignored native app) that is not actionable.
- **Always ask the user for permission before deleting anything knip flags.** Never remove "dead" code unattended.
- Verify each candidate first: `grep` the symbol/file repo-wide, and check whether an export flagged as unused is still used _within its own file_ (then only drop the `export` keyword, don't delete the symbol).
- Known false positives — do NOT remove:
  - shadcn/ui re-exports under `apps/web/src/components/ui/**` (e.g. `DialogClose`, `buttonVariants`) are kept as a deliberate API surface.
  - generated files like `routeTree.gen.ts` (TanStack Router).
  - dependencies consumed indirectly: `prettier`/`prettier-plugin-tailwindcss` (via `eslint-plugin-prettier` in `eslint.config.cjs`), and anything invoked only from config files or root orchestration.
  - **transitive runtime deps of bundled workspace packages.** The backend prod build (`scripts/build--prod.sh`, TS project references) compiles `@flicktionary/api-client` and `@flicktionary/core` into `apps/backend/dist/packages/**`. Those bundled files keep their own `import`s, so every _runtime_ dep of api-client/core must ALSO be a direct `apps/backend` dependency (e.g. `@orpc/contract`, `zod`) — even though nothing in `apps/backend/src` imports them. Removing one passes typecheck/build/tests locally (resolved via hoisted workspace `node_modules`) but throws `ERR_MODULE_NOT_FOUND` at runtime on Railway, where only `apps/backend`'s own deps are installed. Before removing any backend dep, cross-check `packages/api-client/src` and `packages/core/src` imports. The `deploy-smoke` CI job (`.github/workflows/backend-ci.yaml`) boots the compiled artifact from a fresh clone and catches this class post-merge — a tripwire, not a license to skip the cross-check.
- The "Unused dependencies" category is the least reliable — prefer surgical, verified removals over bulk deletes, and re-run `pnpm install` afterward to sync the lockfile.
- When knip is wrong about an entry point or generated file, teach it via `knip.json` rather than deleting working code.

# Comments

Rules:

- It's ok to put comments above big chunks of JSX in react components, this way we do not need to extract too many components
- Try to explain why you did something rather than what and how you did it.
- add links to docs above tickets, if the user provided the link.
  example:

```node
 // based on https://elevenlabs.io/docs/api-reference/twilio/outbound-call
 export const initiateCancelCallViaTwilio = async (
```

- **No log-like comments.** Comments describe how the code behaves *now*, not the
  history of how it got here. Do **not** reference implementation plans, phases,
  migration steps, "as of", dated changes, or "this used to be X, now it's Y" —
  plans are ephemeral and dates are meaningless to a future reader. Describe the
  current behavior directly instead.
  - Bad: `// Phase 4b: forms are now independent facets` /
    `// dropped the learning_mode column on 2026-06-11` /
    `// reversal of the v2 plan's confirm-gate`
  - Good: `// each inflected form is an independent facet with its own schedule`
- The **only** allowed time/issue references are ones a future reader genuinely
  needs to act on: a link to a GitHub issue (or similar tracker), a specific PR,
  or a still-open problem whose comment needs a timestamp/condition so someone
  knows when to re-check it (e.g. `// workaround for https://github.com/owner/repo/issues/123 — remove once fixed`).
- When you edit code that already carries a log-like comment, rewrite it to
  describe current behavior (or delete it) as part of your change — don't leave
  it just because you didn't write it.

# Local Supabase Instance

When the user refers to their "local DB" (resetting it, querying it, updating rows while testing dev), they mean the **dev-tunnel** instance, not `supabase-dev`. `supabase-dev` is the remote dev environment; `supabase-dev-tunnel` is the locally-running Supabase that the user actually develops against.

- DB connection: `postgresql://postgres:postgres@127.0.0.1:34322/postgres` (port `34322`, not the default `54322`)
- Start it with: `pnpm db:dev:tunnel` (runs `doppler run -- supabase start` in `apps/backend/supabase/supabase-dev-tunnel/supabase`)
- Reset it with: `doppler run -- supabase db reset --local` from `apps/backend/supabase/supabase-dev-tunnel/`
- The connection string is exposed as `SUPABASE_CONNECTION_STRING` (Doppler `backend` project, `dev_personal` config) — any standalone script that touches the local DB should read it from there and be run via `doppler run --`. Do not hardcode `54322`.

# Database Migrations

The canonical migrations directory is `apps/backend/supabase/migrations/`. The four Supabase environment folders each have a `supabase/migrations` symlink pointing to it:

- `apps/backend/supabase/supabase-dev-tunnel/supabase/migrations` → `../../migrations` (local dev — the one you reset and iterate against)
- `apps/backend/supabase/supabase-dev/supabase/migrations` → `../../migrations` (remote dev)
- `apps/backend/supabase/supabase-test/supabase/migrations` → `../../migrations` (test)
- `apps/backend/supabase/supabase-prod/supabase/migrations` → `../../migrations` (production)

This means there's exactly one copy of each migration file on disk; the four envs cannot drift. The app is deployed, so migrations are append-only: do not edit an existing migration to change the database schema unless the user explicitly asks for a history rewrite before that migration has been applied anywhere. Every schema/data migration change should be a new migration. Historical docs or resume notes may mention editing a consolidated or initial migration in place; those notes are stale and must not be followed. The workflow is:

1. From `apps/backend/supabase/supabase-dev-tunnel/`, create the migration with the Supabase CLI so the timestamp prefix is correct and the file lands in the symlinked directory (which resolves to the canonical location):

   ```bash
   supabase migration new <name>
   ```

2. Edit only the newly created migration file, then verify it applies cleanly with `doppler run -- supabase db reset --local`.

The root `pnpm db:reset` script is a wrapper for the dev-tunnel reset. The backend package does **not** expose a plain `db:reset` script; from package scope use `pnpm --filter @flicktionary/backend db:dev:tunnel:reset`.

That's it — no copying, no sync step. Never hand-write the timestamp prefix or create the file with `touch` / `Write` directly; `supabase migration new` is the source of truth for ordering. Never replace any of the four `supabase/migrations` symlinks with a real directory.

**Always prefix Supabase CLI commands with `doppler run --`** (e.g. `doppler run -- supabase db reset --local`, `doppler run -- supabase start`, `doppler run -- supabase stop`). Doppler injects the secrets the local stack needs (auth providers, etc.) — without it, the CLI runs against an unconfigured environment and either errors out or silently boots with wrong values.

# Database Types

When the database schema changes (new tables, columns, enums, etc.), regenerate the TypeScript types to keep them in sync.

**Never hand-edit `database.public.types.ts` or `database.auth.types.ts`.** They are generated artifacts. The generator emits tables/columns/enums in strict alphabetical order; editing by hand (e.g. pasting a new table block) drops entries in the wrong place and risks silently mistyping columns, nullability, or the `Date`-vs-`string` quirk. Always regenerate with the script.

With the local (dev-tunnel) Supabase running (`pnpm db:dev:tunnel`), run one command from package scope:

```bash
pnpm --filter @flicktionary/backend db:dev:tunnel:gen-types
```

This regenerates both schema files (public + auth) straight into `src/transport/database/`, formats them with prettier, and runs `check:types`. Then review the diff and commit. The only legitimate diff is genuine schema changes — if you see a large quote-style/semicolon diff, the formatting step was skipped (don't run the raw `supabase gen types` by hand; use the script, which handles `doppler run --`, output paths, and formatting for you).

See `apps/backend/src/transport/database/README.md` for usage examples.

# Backend testing

Two kinds of backend tests, split by filename and picked up by pattern in `apps/backend/vitest.config.mts`:

- `*.unit.test.ts` — pure logic. The dominant style extracts pure functions and feeds them hand-built row objects; LLM prompt/parser code is unit-tested against static strings. No mocking framework for vendor APIs.
- `*.integration.test.ts` — run against the local `supabase-test` stack (ports 64xxx): repository SQL tests, and router tests driving `buildApp` over HTTP with supertest.

**When to add which** (do this by default when shipping backend changes, don't wait to be asked):

- Pure logic (schedulers, parsers, mappers) → unit test, as usual.
- New or changed repository SQL → an integration test for that repository ships with the change.
- New or changed oRPC surface → extend (or add) that router's golden-path integration test: supertest through `buildApp`, golden path + a 401 + one domain failure. Not exhaustive scenarios — those stay in unit tests. Canonical pattern: `apps/backend/src/router/glosses-router/glosses-router.integration.test.ts`. Routers still untested over HTTP get a test when their surface next changes, not as a sweep.

**Conventions** — the suite runs test files in parallel against one shared, **never-reset** database, so:

- Every test creates its own unique users/rows via the helpers in `src/test/test-utils.ts` (unique emails by default). Never hardcode an email, never wipe tables or auth users globally, and anything you assert on must be keyed by a per-test unique value (no whole-table counts).
- LLM calls are injected: pass `MockAnthropicPasses({ ...scripted pass outputs })` through `buildApp` / `ProcessingDependencies`. Never `vi.mock` a vendor client module.
- Seed through the API where a synchronous flow exists (e.g. `/cards/adhoc` is how practice tests get a kept term); use repos directly only for prefs-style setup.

**Running**: `pnpm --filter @flicktionary/backend test:integration:run [file...]` starts the stack and runs the tests (arguments are forwarded to vitest, so single-file runs go through the same script). A vitest globalSetup applies pending migrations to the supabase-test stack before every non-unit run — including the pre-push hook's `vitest run` and direct single-file invocations — so a freshly created migration cannot leave the test schema behind. The stack itself must be running for integration tests (`pnpm --filter @flicktionary/backend db:test` if it isn't).

**CI**: `.github/workflows/backend-ci.yaml` runs on pushes to `main` only, as a non-blocking tripwire for what pre-push structurally can't test — the server-side merge commit and clean-machine effects. Two jobs: the full backend suite against a fresh supabase-test stack, and a deploy smoke test that builds with Railway's exact build command and boots the compiled server from the fresh clone (catches the transitive-dep `ERR_MODULE_NOT_FOUND` class — see the knip section). Pre-push remains the primary gate; a red CI run on `main` means the merge result differs from what was tested locally.
