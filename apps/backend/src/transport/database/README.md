# Database Types

This directory contains auto-generated TypeScript types for our Supabase database schemas. These types are generated from the local Supabase instance and should be regenerated whenever the database schema changes.

## Generated Type Files

- `database.public.types.ts` - Types for the `public` schema (our application tables)
- `database.auth.types.ts` - Types for the `auth` schema (Supabase auth tables)

## Generating Types

**Never hand-edit these files** — they are generated. The generator orders everything alphabetically; manual edits land in the wrong place and risk mistyping columns. Always regenerate with the script.

With the local (dev-tunnel) Supabase running (`pnpm db:dev:tunnel`), run one command:

```bash
pnpm --filter @flicktionary/backend db:dev:tunnel:gen-types
```

It regenerates both schema files (public + auth), formats them with prettier, and runs `check:types`. Then review the diff and commit. (The script wraps `supabase gen types typescript --local` with the required `doppler run --` prefix and the right output paths — see `scripts/db--dev-tunnel--gen-types.sh`.)

## Usage

Use the `Tables`, `TablesInsert`, and `Enums` helpers from the generated types:

```typescript
import { Tables, TablesInsert, Enums } from './database.public.types'

// Row type (for SELECT results)
type User = Tables<'users'>

// Insert type (for INSERT operations)
type UserInsert = TablesInsert<'users'>

// Enum type
type SubscriptionStatus = Enums<'stripe_subscription_status'>
```

For the auth schema, use the schema option:

```typescript
import { Tables } from './database.auth.types'

type AuthUser = Tables<{ schema: 'auth' }, 'users'>
```

## Known Limitation: Date Types

The Supabase type generator outputs `string` for timestamp columns because the Supabase JS client serializes dates as ISO strings. However, our postgres client (`postgres.js`) returns native `Date` objects at runtime.

This means there's a mismatch between TypeScript types and runtime behavior:

- TypeScript type: `created_at: string`
- Actual runtime value: `Date` object

For more context, see:

- https://github.com/orgs/supabase/discussions/27556
- https://github.com/supabase/postgrest-js/issues/201
