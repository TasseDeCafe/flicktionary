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

# Task tracking

Tasks, bugs, and ideas live in **GitHub Issues** on this repo (browse/edit with `gh issue …`), with a kanban board layered on top: https://github.com/users/TasseDeCafe/projects/1 (Status: Backlog / Todo / In Progress / Done / Won't do, plus a Priority field). Conventions:

- **Milestones are epics/phases** (e.g. `Anonymous signup`, `Prelaunch`). Labels beyond the GitHub defaults: `idea`, `ux`, `dx`, `infra`, `extension`, `practice`, `marketing`, `feedback`, `blocked`.
- **PRs close issues**: when a PR resolves a filed issue, put `Fixes #N` in the PR body (the `create-pr` skill covers this). The board maintains itself via project workflows — new issues auto-add to Backlog, closed issues move to Done — so work at the **issue** level; don't script the project API except to set Status/Priority deliberately.
- **Stacked PRs**: load the **`gh-stack` skill** before creating or merging dependent PRs (a PR based on another PR's branch). Old-style base-chained PRs and GitHub-native stacks behave differently — native stacks refuse `gh pr merge` and `--base` edits and merge the whole chain via the async merge API — and an old-style chain can be converted to native in the web UI after creation, so never assume which you have; the skill covers detection and both merge paths.
- **Side quests found mid-session**: offer to file a labeled issue (`gh issue create`) instead of leaving the idea in conversation. `docs/proposals/` stays reserved for actual design documents; an issue can link to one.
- **Images in issues/PRs**: GitHub has no public API for attachment uploads, so use the `gh image <file>` CLI extension — it uploads via the web UI's internal endpoint and prints ready-to-embed markdown (`![name](url)`) for `gh issue`/`gh pr` bodies. Screenshots pasted into an agent chat land on disk as files and can be uploaded directly. The extension is a **locally audited from-source build** with browser-cookie auth; setup, upgrade rules (never `gh extension upgrade` it), and embed recipes live in the user-level `github-image-upload` skill.
- Editing the board itself (fields, columns) needs the classic gh OAuth token with the `project` scope — fine-grained PATs can't manage user-owned Projects v2.

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

Formatting follows the repo prettier config: single quotes (JSX attributes too), no semicolons, ES5 trailing commas.

For our react code style:

- Never import React
  do not do:
  `export const ProgressView: React.FC = () => {`
  just do:
  `export const ProgressView = () => {`

# General guidelines for your answers:

- Do not write code that is backwards compatible unless explicitly asked to do so. Assume that the code is a greenfield project.
- If you spot vestigial/dead code that could be removed, or a high-impact refactor opportunity (renaming for clarity, simplification, reusability), mention it in your message at the end of the task — it doesn't need to be related to the task.

## Localization pattern (Lingui)

- Default to Lingui for every user-facing text. Never ship raw strings; wrap them with `t`` template literals as soon as you add copy.
- In React components or hooks, import `useLingui` and call it near the top (`const { t, i18n } = useLingui()`). Use `t``Text`` in JSX/TS, and call `i18n.\_(messageDescriptor)`for shared descriptor maps like`langNameMessages`.
- Outside React (e.g., config files, query meta, utility modules), import `{ t }` from `@lingui/macro` and, when needed, the shared `i18n` instance for lookups. Keep text in template literals so translators see the full sentence.
- When interpolating values, assign them to descriptive variables and reference them inside the template literal (`const savedCount = ...; t`You saved ${savedCount} phrases``). Avoid string concatenation or unnamed `${expression}` chains.
- Do not set custom ids when calling `t`. The English source string remains the id so extraction keeps working without manual bookkeeping.
- Do NOT translate new strings manually — catalogs are filled by an AI translation script, and that's accepted; just add the English copy in `t`` template literals and leave the catalogs alone. Translation runs at **PR time**: the `create-pr` skill runs `pnpm translate:sync` and commits `packages/i18n/locales` alongside the code (run it yourself for a manual PR). The pre-push hook is a fast **guard**, not a translator — it fails the push if the catalogs are stale or any string is untranslated, telling you to run `pnpm translate:sync`.

## oRPC + TanStack Query

Query hooks over oRPC (declarative invalidation via `meta.invalidates`, the `.key()` vs `.queryKey()` distinction, optimistic updates, error/success meta flags) follow the **`web-query-hooks` skill** — use it whenever creating or modifying a useQuery/useMutation hook in the web app.

Backend oRPC handlers should return DTOs that already match the contract exactly. In particular, normalize `timestamptz` values from Postgres.js to ISO strings in router mappers with `toIsoString` from `apps/backend/src/router/router-utils.ts` instead of relying on JSON serialization to coerce `Date` objects after output validation.

# Web UI patterns

The web app follows opinionated UI idioms (hover/press states, `WizardShell`, sticky CTAs, `OptionCard`, language pickers, mobile inputs, overlay sizing, and loading-state skeletons). When adding or editing a view, card, row, modal, form, or loading state, follow the **`web-ui-patterns` skill** — it holds the canonical examples and the rules to mirror.

# Useful commands:

- Check typing with TS: pnpm check:types (executed from the root directory)
- Check linting with ESLint: pnpm lint (executed from the root directory)
- Find dead code (unused files / exports / dependencies): `pnpm knip` — treat its output as candidates, not facts. Follow the **`remove-dead-code` skill** (known false positives, the bundled-dependency trap), and never delete anything it flags without asking the user.
- Time-travel practice data (test multi-day SRS flows without waiting): `pnpm db:advance-day [--days N] [--email <email>]` shifts every practice timestamp in the dev-tunnel DB backward (all day logic compares against Postgres `NOW()`/`CURRENT_DATE`, so this equals the server day advancing). Same shift, scoped per-account and usable in any environment: the "Practice time travel" card in the web app's admin settings (test users only).

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

# Local database & migrations

When the user refers to their "local DB", they mean the **dev-tunnel** instance (`postgresql://postgres:postgres@127.0.0.1:34322/postgres` — port `34322`, not the default), started with `pnpm db:dev:tunnel` and reset with `pnpm db:reset`. `supabase-dev` is also a local stack (the non-tunnelled one) — the only hosted Supabase project is prod, so dashboard-side settings exist only there. Always prefix Supabase CLI commands with `doppler run --`.

Hard rules (the full workflow — creating migrations, regenerating types, Doppler details — lives in the **`db-migrations` skill**; use it for any schema change):

- Migrations are **append-only**: never edit an existing migration; create a new one with `supabase migration new` from `apps/backend/supabase/supabase-dev-tunnel/` (never hand-write the timestamp prefix or create the file with `touch`/`Write`).
- The four env folders' `supabase/migrations` are symlinks to the canonical `apps/backend/supabase/migrations/` — never replace a symlink with a real directory.
- Never hand-edit the generated `database.public.types.ts` / `database.auth.types.ts`; regenerate with `pnpm --filter @flicktionary/backend db:dev:tunnel:gen-types`.

# Backend testing

Ship tests with backend changes by default — don't wait to be asked:

- Pure logic (schedulers, parsers, mappers) → `*.unit.test.ts`.
- New or changed repository SQL → an integration test for that repository ships with the change.
- New or changed oRPC surface → extend (or add) that router's golden-path integration test (golden path + a 401 + one domain failure).

Conventions (shared never-reset test DB, per-test unique fixtures, injected LLM mocks, run commands) live in the **`backend-testing` skill** — use it whenever writing or running backend tests.
