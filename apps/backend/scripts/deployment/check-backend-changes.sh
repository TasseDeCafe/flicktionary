#!/bin/bash

# Run turbo ls and capture the JSON output
output=$(turbo ls --affected --output=json 2>/dev/null)

# Use jq to check if @template-app/backend is in the packages.items array
if echo "$output" | jq -e '.packages.items[] | select(.name == "@template-app/backend")' > /dev/null; then
  echo "Backend changes detected. Proceeding with deployment..."
  exit 0
else
  echo "No changes detected for backend. Skipping deployment."
  exit 1
fi 