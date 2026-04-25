#!/bin/bash

# Ensure the script exits if any command fails
set -e

VERSION=$(sentry-cli releases propose-version)
sentry-cli releases new --org fluencist -p backend "$VERSION"

sentry-cli releases set-commits --org fluencist -p backend "$VERSION" --auto

sentry-cli sourcemaps inject --org fluencist --project backend --release "$VERSION" ./dist
sentry-cli sourcemaps upload --org fluencist --project backend --release "$VERSION" ./dist

sentry-cli releases finalize --org fluencist -p backend "$VERSION"

sentry-cli releases deploys --org fluencist -p backend "$VERSION" new -e production

echo "Sentry release $VERSION created, source maps uploaded, and deployed successfully"
