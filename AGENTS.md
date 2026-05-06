This turborepo monorepo is the repo of Flicktionary.app. This is a work in progress, don't treat it like a polished product.

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

## Localization pattern (Lingui)

- Default to Lingui for every user-facing text. Never ship raw strings; wrap them with `t`` template literals as soon as you add copy.
- In React components or hooks, import `useLingui` and call it near the top (`const { t, i18n } = useLingui()`). Use `t``Text`` in JSX/TS, and call `i18n.\_(messageDescriptor)`for shared descriptor maps like`langNameMessages`.
- Outside React (e.g., config files, query meta, utility modules), import `{ t }` from `@lingui/macro` and, when needed, the shared `i18n` instance for lookups. Keep text in template literals so translators see the full sentence.
- When interpolating values, assign them to descriptive variables and reference them inside the template literal (`const savedCount = ...; t`You saved ${savedCount} phrases``). Avoid string concatenation or unnamed `${expression}` chains.
- Do not set custom ids when calling `t`. The English source string remains the id so extraction keeps working without manual bookkeeping.

## oRPC + TanStack Query

The web/native apps consume the contract through `@orpc/tanstack-query`'s `createTanstackQueryUtils(...)` (exposed as `orpcQuery`). Two helpers look interchangeable but aren't:

- `orpcQuery.path.method.key(...)` — returns a **partial / prefix** key. Use it for `invalidateQueries` and `cancelQueries`, where prefix matching is the point. `.key()` (no arg) matches every variation; `.key({ input })` narrows the prefix but still uses prefix semantics.
- `orpcQuery.path.method.queryKey({ input })` — returns the **exact full** key including input. Required by `setQueryData` / `getQueryData`, which look up an entry by exact match. Passing a `.key(...)` result here silently no-ops (writes go nowhere; reads return undefined), and the symptom is "the cache won't update / the UI keeps showing stale data after a successful mutation."

Rule of thumb: if you're invalidating, use `.key(...)`. If you're reading or writing the cache directly, use `.queryKey({ input })`. See `apps/web/src/features/review/api/card-cache.ts` for the canonical setQueryData pattern.

# Useful commands:

- Check typing with TS: pnpm check:types (executed from the root directory)
- Check linting with ESLint: pnpm lint (executed from the root directory)

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

# Database Migrations

The canonical migrations directory is `apps/backend/supabase/migrations/`. The four Supabase environment folders each have a `supabase/migrations` symlink pointing to it:

- `apps/backend/supabase/supabase-dev-tunnel/supabase/migrations` → `../../migrations` (local dev — the one you reset and iterate against)
- `apps/backend/supabase/supabase-dev/supabase/migrations` → `../../migrations` (remote dev)
- `apps/backend/supabase/supabase-test/supabase/migrations` → `../../migrations` (test)
- `apps/backend/supabase/supabase-prod/supabase/migrations` → `../../migrations` (production)

This means there's exactly one copy of each migration file on disk; the four envs cannot drift. The workflow is:

1. From `apps/backend/supabase/supabase-dev-tunnel/`, create the migration with the Supabase CLI so the timestamp prefix is correct and the file lands in the symlinked directory (which resolves to the canonical location):

   ```bash
   supabase migration new <name>
   ```

2. Edit the new file, then verify it applies cleanly with `doppler run -- supabase db reset --local`.

That's it — no copying, no sync step. Never hand-write the timestamp prefix or create the file with `touch` / `Write` directly; `supabase migration new` is the source of truth for ordering. Never replace any of the four `supabase/migrations` symlinks with a real directory.

**Always prefix Supabase CLI commands with `doppler run --`** (e.g. `doppler run -- supabase db reset --local`, `doppler run -- supabase start`, `doppler run -- supabase stop`). Doppler injects the secrets the local stack needs (auth providers, etc.) — without it, the CLI runs against an unconfigured environment and either errors out or silently boots with wrong values.

# Database Types

When the database schema changes (new tables, columns, enums, etc.), regenerate the TypeScript types to keep them in sync.

From the `apps/backend/supabase/supabase-dev-tunnel` directory, with local Supabase running:

```bash
# Public schema (application tables)
supabase gen types typescript --local > database.public.types.ts

# Auth schema (Supabase auth tables)
supabase gen types typescript --local --schema auth > database.auth.types.ts
```

See `apps/backend/src/transport/database/README.md` for usage examples.
