#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

pnpm run start-tunnels &
CF_PID=$!

cleanup() {
  trap - EXIT
  if kill -0 "$CF_PID" >/dev/null 2>&1; then
    kill "$CF_PID" >/dev/null 2>&1 || true
    wait "$CF_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT
trap cleanup INT TERM

(
  if ! wait "$CF_PID"; then
    echo "cloudflared tunnel exited unexpectedly" >&2
    kill -INT $$ >/dev/null 2>&1 || true
  fi
) &
MONITOR_PID=$!

# Run the existing tunnel dev tasks (web/backend/db etc.)
turbo run dev:tunnel

wait "$MONITOR_PID" >/dev/null 2>&1 || true
