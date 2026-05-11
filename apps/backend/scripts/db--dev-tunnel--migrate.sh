#!/bin/bash
#
# Apply any pending Supabase migrations against the dev-tunnel DB without
# dropping anything. Use this once you start adding new migration files
# (post-MVP, when the prod DB is live and you can't keep editing in place).
# For now while everything still lives in one edit-in-place migration,
# `db:reset` is what you want.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$BACKEND_DIR/supabase/supabase-dev-tunnel/supabase"
doppler run -- supabase migration up
