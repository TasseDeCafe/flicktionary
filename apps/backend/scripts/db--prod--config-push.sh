#!/bin/bash
#
# Push supabase-prod/supabase/config.toml to the HOSTED prod project. This is
# a deploy, not a dry-run: the CLI auto-confirms in non-interactive/agent
# environments, and absent keys are applied as CLI defaults. Read the header
# of config.toml before changing what gets pushed.
#
# Requires a Supabase login (`supabase login`, or SUPABASE_ACCESS_TOKEN in the
# environment — that's how the prod-config-push CI workflow authenticates).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROD_SUPABASE_DIR="$(cd "$SCRIPT_DIR/../supabase/supabase-prod/supabase" && pwd)"
PROD_PROJECT_REF="uynwhkflqmryzkenccmd"

cd "$PROD_SUPABASE_DIR"

# An env(VAR) whose variable is unset gets pushed as the literal string, which
# once corrupted the prod Google client id. The prod config must not use env()
# at all — secrets stay as "" (= leave the stored value untouched).
if grep -nE '^[^#]*env\(' config.toml; then
  echo 'error: config.toml references env() — replace it with an explicit value, or "" for secrets' >&2
  exit 1
fi

supabase config push --project-ref "$PROD_PROJECT_REF" --yes
