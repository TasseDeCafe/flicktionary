#!/bin/bash

# Run turbo ls and capture the JSON output
output=$(turbo ls --affected --output=json 2>/dev/null)

# Use jq to check if native is in the packages.items array
if echo "$output" | jq -e '.packages.items[] | select(.name == "native")' > /dev/null; then
  echo "Native app changes detected. Running sync-env..."
  yarn workspace native sync-env
  exit 0
else
  echo "No changes detected for native app. Skipping sync-env."
  exit 0
fi 