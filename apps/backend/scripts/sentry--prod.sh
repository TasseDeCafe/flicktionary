#!/bin/bash

# Ensure the script exits if any command fails
set -e

VERSION=$(sentry-cli releases propose-version)
sentry-cli releases new --org template-organization -p backend "$VERSION"

sentry-cli releases set-commits --org template-organization -p backend "$VERSION" --auto

sentry-cli sourcemaps inject --org template-organization --project backend --release "$VERSION" ./dist
sentry-cli sourcemaps upload --org template-organization --project backend --release "$VERSION" ./dist

sentry-cli releases finalize --org template-organization -p backend "$VERSION"

sentry-cli releases deploys --org template-organization -p backend "$VERSION" new -e production

echo "Sentry release $VERSION created, source maps uploaded, and deployed successfully"
