#!/bin/bash

# Ensure the script exits if any command fails
set -e

rm -rf dist

npx tsc --project tsconfig.prod.json

npx tsc-alias --project tsconfig.prod.json

echo "Production build completed successfully"
