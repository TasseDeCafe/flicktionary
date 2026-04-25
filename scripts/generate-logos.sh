#!/bin/bash

# Generate all logo variants from a source image
# Usage: ./scripts/generate-logos.sh [source_image]
# Default source: apps/web/public/logo.png (or logo.jpeg if png doesn't exist)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

WEB_PUBLIC="$ROOT_DIR/apps/web/public"
NATIVE_ASSETS="$ROOT_DIR/apps/native/src/assets/images"

# Determine source image
if [ -n "$1" ]; then
  SOURCE_IMAGE="$1"
elif [ -f "$WEB_PUBLIC/logo.png" ]; then
  SOURCE_IMAGE="$WEB_PUBLIC/logo.png"
elif [ -f "$WEB_PUBLIC/logo.jpeg" ]; then
  SOURCE_IMAGE="$WEB_PUBLIC/logo.jpeg"
else
  echo "Error: No source image found. Provide one as argument or place logo.png/logo.jpeg in apps/web/public/"
  exit 1
fi

# Check if source image exists
if [ ! -f "$SOURCE_IMAGE" ]; then
  echo "Error: Source image not found: $SOURCE_IMAGE"
  exit 1
fi

# Check if magick is installed
if ! command -v magick &> /dev/null; then
  echo "Error: ImageMagick is not installed. Please install it first:"
  echo "  brew install imagemagick"
  exit 1
fi

echo "Generating logos from: $SOURCE_IMAGE"
echo ""

# Create transparent PNG from source (if source is not already the target)
echo "=== Web App ==="
if [ "$SOURCE_IMAGE" != "$WEB_PUBLIC/logo.png" ]; then
  magick "$SOURCE_IMAGE" \
    -fuzz 20% -transparent white \
    -fuzz 20% -transparent "rgb(204,204,204)" \
    "$WEB_PUBLIC/logo.png"
  echo "Created: logo.png (transparent)"
else
  echo "Using existing: logo.png"
fi

# Generate native app images
echo ""
echo "=== Native App ==="

# adaptive-icon.png (264x264) - Android adaptive icon foreground
magick "$WEB_PUBLIC/logo.png" -resize 264x264 "$NATIVE_ASSETS/adaptive-icon.png"
echo "Created: adaptive-icon.png (264x264)"

# favicon.png (48x48)
magick "$WEB_PUBLIC/logo.png" -resize 48x48 "$NATIVE_ASSETS/favicon.png"
echo "Created: favicon.png (48x48)"

# icon.png (264x264) - iOS app icon
magick "$WEB_PUBLIC/logo.png" -resize 264x264 "$NATIVE_ASSETS/icon.png"
echo "Created: icon.png (264x264)"

# splash-icon.png (1024x1024) - Splash screen icon
magick "$WEB_PUBLIC/logo.png" -resize 1024x1024 "$NATIVE_ASSETS/splash-icon.png"
echo "Created: splash-icon.png (1024x1024)"

echo ""
echo "All logos generated successfully!"