#!/bin/bash
# Wrapper script to run the TypeScript fingerprint checker
# This script checks if native app changes require a new build (version bump)
#
# Usage:
#   check-native-fingerprint.sh [check|update]
#
# Exit codes:
#   0 - No native build required (fingerprints match)
#   1 - Native build required (fingerprints differ)
#   2 - Error occurred

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$SCRIPT_DIR/.." && npx tsx "$SCRIPT_DIR/check-native-fingerprint.ts" "$@"
