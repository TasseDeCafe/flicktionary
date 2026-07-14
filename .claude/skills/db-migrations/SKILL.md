---
name: db-migrations
description: Creates a database migration against the local dev-tunnel Supabase stack and regenerates the TypeScript DB types. Use whenever changing the database schema (new table, column, enum, index, RLS policy, or data migration), or when database.public.types.ts is out of sync with the schema.
---

You are changing the database schema. Two invariants, then the workflow.

## Invariants

- **Migrations are append-only.** The app is deployed, so never edit an existing migration to change the schema unless the user explicitly asks for a history rewrite before that migration has been applied anywhere. Every schema/data change is a new migration. Historical docs or resume notes that mention editing a consolidated or initial migration in place are stale — do not follow them.
- **One canonical directory, four symlinks.** The canonical migrations directory is `apps/backend/supabase/migrations/`. The four Supabase environment folders each have a `supabase/migrations` symlink pointing to it:
  - `apps/backend/supabase/supabase-dev-tunnel/supabase/migrations` → `../../migrations` (local dev — the one you reset and iterate against)
  - `apps/backend/supabase/supabase-dev/supabase/migrations` → `../../migrations` (remote dev)
  - `apps/backend/supabase/supabase-test/supabase/migrations` → `../../migrations` (test)
  - `apps/backend/supabase/supabase-prod/supabase/migrations` → `../../migrations` (production)

  Exactly one copy of each migration file exists on disk, so the four envs cannot drift. Never replace any of the four symlinks with a real directory.

## Doppler

**Always prefix Supabase CLI commands with `doppler run --`** (e.g. `doppler run -- supabase db reset --local`, `doppler run -- supabase start`, `doppler run -- supabase stop`). Doppler injects the secrets the local stack needs (auth providers, etc.) — without it, the CLI runs against an unconfigured environment and either errors out or silently boots with wrong values.

## Creating a migration

1. From `apps/backend/supabase/supabase-dev-tunnel/`, create the migration with the Supabase CLI so the timestamp prefix is correct and the file lands in the symlinked directory (which resolves to the canonical location):

   ```bash
   supabase migration new <name>
   ```

   Never hand-write the timestamp prefix or create the file with `touch` / `Write` directly; `supabase migration new` is the source of truth for ordering.

2. Edit only the newly created migration file, then verify it applies cleanly with `doppler run -- supabase db reset --local` (from `apps/backend/supabase/supabase-dev-tunnel/`).

That's it — no copying, no sync step. The root `pnpm db:reset` script is a wrapper for the dev-tunnel reset. The backend package does **not** expose a plain `db:reset` script; from package scope use `pnpm --filter @flicktionary/backend db:dev:tunnel:reset`.

## Regenerating the TypeScript DB types

When the schema changes (new tables, columns, enums, etc.), regenerate the types.

**Never hand-edit `database.public.types.ts` or `database.auth.types.ts`.** They are generated artifacts. The generator emits tables/columns/enums in strict alphabetical order; editing by hand (e.g. pasting a new table block) drops entries in the wrong place and risks silently mistyping columns, nullability, or the `Date`-vs-`string` quirk.

With the local (dev-tunnel) Supabase running (`pnpm db:dev:tunnel`), run one command from package scope:

```bash
pnpm --filter @flicktionary/backend db:dev:tunnel:gen-types
```

This regenerates both schema files (public + auth) straight into `src/transport/database/`, formats them with prettier, and runs `check:types`. Then review the diff and commit. The only legitimate diff is genuine schema changes — a large quote-style/semicolon diff means the formatting step was skipped (don't run the raw `supabase gen types` by hand; the script handles `doppler run --`, output paths, and formatting).

See `apps/backend/src/transport/database/README.md` for usage examples.

## Local DB facts

- Connection: `postgresql://postgres:postgres@127.0.0.1:34322/postgres` (port `34322`, not the default `54322`).
- Start: `pnpm db:dev:tunnel` (runs `doppler run -- supabase start` in `apps/backend/supabase/supabase-dev-tunnel/supabase`).
- The connection string is exposed as `SUPABASE_CONNECTION_STRING` (Doppler `backend` project, `dev_personal` config) — any standalone script that touches the local DB should read it from there and be run via `doppler run --`. Do not hardcode `54322`.
- A vitest globalSetup applies pending migrations to the supabase-test stack before every non-unit test run, so a freshly created migration cannot leave the test schema behind (see the `backend-testing` skill).
