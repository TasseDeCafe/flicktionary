#!/bin/bash

# Content hash of the repo as it would be pushed: HEAD plus staged, unstaged,
# and untracked changes (respecting .gitignore). Built in a throwaway index so
# the real index and working tree are never touched. `pnpm verify` stamps this
# hash on success and the pre-push hook compares against it to decide whether
# the expensive checks can be skipped. Hashing the working snapshot (rather
# than HEAD's tree) means a verify run before committing still matches at push
# time, as long as everything gets committed.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

tmp_index=$(mktemp)
trap 'rm -f "$tmp_index"' EXIT
export GIT_INDEX_FILE="$tmp_index"

git read-tree HEAD
git add -A
git write-tree
