#!/bin/bash

echo "🧹 Starting complete Expo app dependency cleanup..."

# Navigate to the root directory of the project
cd ../..

# Prompt to delete app on phone
echo ""
read -p "❓ Have you deleted the app from your phone? (y/n): " deleted_app
if [[ $deleted_app != "y" ]]; then
    echo "⚠️  Please delete the app from your phone before continuing."
    read -p "Press Enter once you've deleted the app..."
fi

# Delete all node_modules folders in the repository
echo "🗑️  Removing all node_modules folders..."
find . -name "node_modules" -type d -prune -exec rm -rf {} \;

# Remove iOS and .expo folders in apps/native
echo "🗑️  Removing iOS and .expo folders in apps/native..."
rm -rf apps/native/ios
rm -rf apps/native/android
rm -rf apps/native/.expo

# Remove Expo caches
echo "🗑️  Removing Expo caches..."
rm -rf ~/.expo
rm -rf $TMPDIR/metro-*
rm -rf $TMPDIR/haste-map-*
rm -rf ${TMPDIR:-/tmp}/metro-*

# Clear watchman watches
if command -v watchman &> /dev/null; then
    echo "🔄 Resetting watchman..."
    watchman watch-del-all
fi

# Clear Metro bundler cache
echo "🗑️  Clearing Metro bundler cache..."
rm -rf $TMPDIR/metro-cache

# Install dependencies
echo "📦 Installing dependencies with pnpm..."
pnpm install

echo "✅ Reset process completed!"
