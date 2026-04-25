#!/bin/bash
set -euo pipefail

if [[ -z "${CLOUDFLARED_TOKEN:-}" ]]; then
  # shellcheck disable=SC2016
  echo "Starting cloudflared tunnel via Doppler..."
  doppler run -- bash -c 'cloudflared tunnel run --token "$CLOUDFLARED_TOKEN"'
else
  echo "Starting cloudflared tunnel with existing token..."
  cloudflared tunnel run --token "$CLOUDFLARED_TOKEN"
fi
