#!/bin/bash
#
# Regenerate the Supabase TypeScript types from the running dev-tunnel DB.
# These files are GENERATED ARTIFACTS — never hand-edit them. The generator
# orders tables/columns/enums alphabetically; manual edits land in the wrong
# place and risk mistyping columns. Re-run this script after any schema change
# (new migration applied), then commit the result.
#
# Requires the dev-tunnel Supabase to be running (`pnpm db:dev:tunnel`).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$BACKEND_DIR/../.." && pwd)"
TYPES_DIR="$BACKEND_DIR/src/transport/database"

cd "$BACKEND_DIR/supabase/supabase-dev-tunnel/supabase"

echo "Generating public schema types..."
doppler run -- supabase gen types typescript --local \
  > "$TYPES_DIR/database.public.types.ts"

echo "Generating auth schema types..."
doppler run -- supabase gen types typescript --local --schema auth \
  > "$TYPES_DIR/database.auth.types.ts"

# Raw generator output uses double quotes + semicolons; normalize to our
# prettier style so the only diff is genuine schema changes.
echo "Formatting..."
cd "$REPO_ROOT"
npx prettier --config .prettierrc.cjs --write \
  "$TYPES_DIR/database.public.types.ts" \
  "$TYPES_DIR/database.auth.types.ts"

echo "Typechecking..."
pnpm --filter @flicktionary/backend check:types

echo "Done. Review the diff and commit."
