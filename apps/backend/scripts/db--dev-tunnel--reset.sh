#!/bin/bash
#
# Reset the dev-tunnel Supabase DB while preserving the reference data
# (wiktionary tables + lemma ranks). The flow is:
#
#   1. If no snapshot exists yet, dump the current reference tables to
#      .cache/wiktionary/wiktionary.dump.
#   2. Run `supabase db reset` (drops + re-applies migrations + reseeds).
#   3. If a snapshot exists, pg_restore the reference tables.
#
# The table list mirrors REFERENCE_TABLES in snapshot-reference-tables.ts:
# a fresh `pnpm load:kaikki` or `pnpm build:lemma-ranks` invalidates and
# rewrites the snapshot at the end of its run, so refreshes propagate
# automatically.
#
# We run pg_dump / pg_restore *inside* the Supabase Postgres container so the
# client tool versions always match the server (15.x). Using Homebrew's
# pg_dump on the host fails when the server is a newer major version.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DUMP_DIR="$SCRIPT_DIR/.cache/wiktionary"
DUMP_FILE="$DUMP_DIR/wiktionary.dump"
CONNECTION_STRING="postgresql://postgres:postgres@127.0.0.1:34322/postgres"
CONTAINER="supabase_db_supabase-dev-tunnel"

# --- Phase 1: snapshot-if-missing ----------------------------------------
if [ ! -s "$DUMP_FILE" ]; then
  TABLE_EXISTS=$(psql "$CONNECTION_STRING" -tAc \
    "SELECT to_regclass('public.wiktionary_entries')::text" 2>/dev/null || echo "")
  if [ -n "$TABLE_EXISTS" ]; then
    ENTRY_COUNT=$(psql "$CONNECTION_STRING" -tAc \
      "SELECT COUNT(*) FROM public.wiktionary_entries" 2>/dev/null || echo "0")
    if [ "$ENTRY_COUNT" -gt 0 ]; then
      echo "→ No snapshot cached. Dumping current reference tables (via container)..."
      mkdir -p "$DUMP_DIR"
      DUMP_START=$(date +%s)
      # Write to a tmp path and only rename on success, so a failed pg_dump
      # never leaves a zero-byte file masquerading as a valid snapshot.
      docker exec -i "$CONTAINER" pg_dump \
        -U postgres -d postgres \
        --data-only \
        --table=public.wiktionary_entries \
        --table=public.wiktionary_forms \
        --table=public.wiktionary_form_redirects \
        --table=public.lemma_ranks \
        --table=public.lemma_rank_builds \
        -Fc > "$DUMP_FILE.tmp"
      mv "$DUMP_FILE.tmp" "$DUMP_FILE"
      echo "  ✓ Saved $(du -h "$DUMP_FILE" | cut -f1) snapshot in $(($(date +%s) - DUMP_START))s"
    else
      echo "→ wiktionary tables exist but are empty; nothing to snapshot."
      echo "  Run 'pnpm --filter @flicktionary/backend load:kaikki' to populate."
    fi
  else
    echo "→ No wiktionary tables exist yet (no snapshot to take)."
  fi
fi

# --- Phase 2: reset ------------------------------------------------------
echo "→ Running supabase db reset (dev-tunnel)..."
cd "$BACKEND_DIR/supabase/supabase-dev-tunnel/supabase"
doppler run --project backend --config dev_personal -- supabase db reset

# --- Phase 3: restore reference tables -----------------------------------
if [ -s "$DUMP_FILE" ]; then
  echo "→ Restoring reference tables from snapshot (via container, serial)..."
  RESTORE_START=$(date +%s)
  docker exec -i "$CONTAINER" pg_restore \
    -U postgres -d postgres \
    --data-only --no-owner --no-acl < "$DUMP_FILE"
  RESTORE_ELAPSED=$(($(date +%s) - RESTORE_START))

  ENTRIES=$(psql "$CONNECTION_STRING" -tAc \
    "SELECT COUNT(*) FROM public.wiktionary_entries" 2>/dev/null || echo "?")
  FORMS=$(psql "$CONNECTION_STRING" -tAc \
    "SELECT COUNT(*) FROM public.wiktionary_forms" 2>/dev/null || echo "?")
  RANKS=$(psql "$CONNECTION_STRING" -tAc \
    "SELECT COUNT(*) FROM public.lemma_ranks" 2>/dev/null || echo "?")
  echo "  ✓ Restored: $ENTRIES entries, $FORMS forms, $RANKS lemma ranks in ${RESTORE_ELAPSED}s"
else
  echo "→ Reset complete. No reference-table snapshot to restore."
  echo "  Run 'pnpm --filter @flicktionary/backend load:reference-data' to populate."
fi
