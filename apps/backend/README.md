# app-monorepo-template.dev backend

## run

install dependencies with

```
pnpm
```

run the dev server

```
pnpm dev
```

run the dev server on mobile (expose the url to the internet)

```
pnpm db:dev:tunnel
```

then

```
pnpm dev:tunnel
```

## Database

We use Supabase:

install supabase cli. Refer to: https://supabase.com/docs/guides/cli/getting-started

Keep supabase cli always up to date!!

- pros:
  - it's powered by postgresql, which is a very mature database with great safety/scalability features
  - as opposed to a self-hosted database, supabase can be replicated to multiple locations around the globe (only for read)
  - it gives realtime features like firebase
  - we use supabase' authentication too
  - it gives a powerful ui and sql editor
  - no need to worry about installing/updating databases by hand, everything is dockerized
- cons
  - running supabase locally is potentially cumbersome, it's ~6-10 docker images. If we went for a self-hosted postgresql we would just use `psql` or any other postgresql client
  - using supabase adds an overhead to a regular postgresql database, for example `supabase start` takes ~25 seconds to run while `supabase stop` takes around ~10 seconds. Remember that from time to time the supabase docker images have to be updated, which takes time even more time.

Observations:

- the single source of truth for database schema are our migration files, and not any orm files like prisma's `schema.prisma` etc.

useful articles:

- local development with supabase: https://supabase.com/docs/guides/cli/local-development
- managing migrations with supabase: https://supabase.com/docs/guides/cli/managing-environments
- managing user data: https://supabase.com/docs/guides/auth/managing-user-data

Two instances of supabase are used, one for local development/debugging/tinkering, one for running automated tests. The only difference between the configs are the ports on which both instances run.

If you have to add a feature that modifies the database, you'll have to use a subset of the below steps:

1. `pnpm db:dev` - run supabase locally
   if you want you can tinker/debug change directly in the local supabase ui, for this go to http://127.0.0.1:54323.
   Some changes are possible to add directly in the ui (for example modifying a column type, add a table etc.),
   for others it won't be possible. Remember that this step is just for tinkering as you have to write SQK migration
   files anyway
2. `supabase migration new create_employees_table` create a migration and fill it with sql altering tables' definition
3. `supabase migration up` - apply your migration
4. copy the migration file that looks something like `20240127184119_create_employees_table` to the `supabase/supabase-test/migrations` directory. They always have to be in sync (in the future we could automate this step)
5. `pnpm db:test` - run supabase locally for tests
6. if needed, write integration test that connects to the test supabase instance
7. push changes to github in a PR and merge it to main in the github ui. The newly added migration will be applied to the production supabase instance automatically thanks to our github action workflow

To enter studio run:

```
supabase start
```

go to http://127.0.0.1:54323 or http://127.0.0.1:64323 (test environment)

useful commands:

- `supabase login` - logs you in into supabase and allows you to link the projects you have access to
- `supabase start` - run supabase locally, which includes api, database and ui
- `supabase stop` - stops the above
- `supabase link --project-ref krtllimmygzciwxngbmd` links to a remote supabase project
- `supabase db pull` - pulls the migrations from the remote project currently linked
- `supabase db push` - pushes the not yet applied migrations to the remote project currently linked
- `supabase migration new create_employees_table` - creates a new migration file
- `doppler run -- supabase db reset` - drops the local databases completely, useful if you messed up your database definition in the ui and want to apply migrations again
- `supabase migration list` - list local and remote migrations
- `supabase migration up` - apply migrations if not yet applied
