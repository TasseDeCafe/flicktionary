#!/bin/bash

# The full verification battery that gates a push: Lingui catalog guard, backend
# email templates, lint, typecheck, tests, build. On success it stamps the
# repo's content hash (scripts/tree-hash.sh) so the pre-push hook skips these
# checks when the pushed tree is exactly what already passed. Run `pnpm verify`
# as the one final full check before pushing — targeted per-package commands
# remain the right tool while iterating.

set -uo pipefail

cd "$(dirname "$0")/.."

# Guard the Lingui catalogs. We do NOT translate here: the AI call is slow and
# its auto-commit can't join an in-flight push (forcing a "push again" dance),
# and the gettext re-serialization used to ping-pong the catalog format. Instead
# translation happens at PR time (`pnpm translate:sync`, run by the create-pr
# flow), and this stays a fast, deterministic gate that fails if the catalogs
# are stale or any string is untranslated.
echo "🧹 Checking Lingui catalogs..."
if ! pnpm lingui extract --clean; then
  echo "❌ Lingui extract failed"
  exit 1
fi

if ! git diff --quiet -- packages/i18n/locales; then
  echo "❌ Lingui catalogs are out of date (extract changed them)."
  echo "   Run 'pnpm translate:sync' and commit packages/i18n/locales before pushing."
  git --no-pager diff --stat -- packages/i18n/locales
  exit 1
fi

if ! pnpm --filter @flicktionary/i18n translate:check; then
  echo "❌ Some strings are untranslated."
  echo "   Run 'pnpm translate:sync' and commit packages/i18n/locales before pushing."
  exit 1
fi
echo "✅ Lingui catalogs are up to date and fully translated"

echo "📧 Checking email templates..."
if ! (cd apps/backend && pnpm check-templates); then
  echo "❌ Email template check failed"
  exit 1
fi

# Read-only lint gate. eslint auto-fixes are applied by the pre-commit hook
# (lint-staged) at commit time, so they ride along in the same push — there is
# no --fix here, nothing to auto-commit, and no "push again" dance. This only
# fails on genuine lint errors (including a fixable issue committed with
# --no-verify, which the pre-commit hook would otherwise have fixed).
echo "Running lint..."
if pnpm lint:check; then
  echo "✅ Lint passed"
else
  echo "❌ Lint failed (run 'pnpm lint' to auto-fix, then commit)"
  exit 1
fi

echo "Checking types..."
if pnpm check:types; then
  echo "✅ Types check passed"
else
  echo "❌ Types check failed"
  exit 1
fi

echo "Running tests..."
if pnpm test:run; then
  echo "✅ Tests passed"
else
  echo "❌ Tests failed"
  exit 1
fi

echo "Building..."
if pnpm build; then
  echo "✅ Build passed"
else
  echo "❌ Build failed"
  exit 1
fi

stamp_file="$(git rev-parse --git-dir)/flicktionary-verify-stamp"
scripts/tree-hash.sh > "$stamp_file"
echo "✅ All checks passed — stamped $(cut -c1-12 "$stamp_file") so the next push skips them."
