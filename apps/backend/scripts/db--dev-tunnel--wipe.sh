#!/bin/bash
#
# Wipe user data from the dev-tunnel DB without dropping the schema or
# touching wiktionary reference data. Use this when you just want clean
# test data and aren't iterating on the migration; for migration changes,
# use `db:reset` (which drops + reapplies + restores wiktionary).
#
# Truncates every table in the `public` schema except those prefixed with
# `wiktionary_`, then clears `auth.users` (which cascades through public.users
# via FK to wipe any auth-linked rows that survived).
#
set -euo pipefail

CONNECTION_STRING="postgresql://postgres:postgres@127.0.0.1:34322/postgres"

WIPE_START=$(date +%s)

psql "$CONNECTION_STRING" -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
DO $$
DECLARE
  table_list TEXT;
BEGIN
  SELECT string_agg('public.' || quote_ident(tablename), ', ')
    INTO table_list
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename NOT LIKE 'wiktionary_%';

  IF table_list IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE ' || table_list || ' RESTART IDENTITY CASCADE';
  END IF;
END $$;

DELETE FROM auth.users;
SQL

WIPE_ELAPSED=$(($(date +%s) - WIPE_START))

ENTRIES=$(psql "$CONNECTION_STRING" -tAc \
  "SELECT COUNT(*) FROM public.wiktionary_entries" 2>/dev/null || echo "?")
echo "✓ User data wiped in ${WIPE_ELAPSED}s (wiktionary_entries still has $ENTRIES rows)"
