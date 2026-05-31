#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# cloudflared tunnel (via Doppler) — child of THIS shell.
pnpm run start-tunnels &
CF_PID=$!

# The dev tasks (web/backend/extension/native etc.) — also a child of THIS
# shell, so we can wait/poll both from the same place.
turbo run dev:tunnel &
TURBO_PID=$!

cleanup() {
  trap - EXIT INT TERM
  kill "$CF_PID" "$TURBO_PID" >/dev/null 2>&1 || true
  wait "$CF_PID" "$TURBO_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

# Exit as soon as EITHER the tunnel or the dev tasks stop. We poll with
# `kill -0` instead of `wait -n` because the latter only learns process
# arguments in bash 5.1+, and macOS still ships bash 3.2.
while kill -0 "$CF_PID" 2>/dev/null && kill -0 "$TURBO_PID" 2>/dev/null; do
  sleep 1
done

if ! kill -0 "$CF_PID" 2>/dev/null; then
  echo "cloudflared tunnel exited unexpectedly" >&2
fi

# cleanup (EXIT trap) tears down whatever is still running.
