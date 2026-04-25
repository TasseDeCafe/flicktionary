#!/bin/bash

# Unified script to run the Expo app on a specific iOS or Android device
# whose UDID/ID is stored in Doppler.

PLATFORM=$1

if [ -z "$PLATFORM" ]; then
  echo "Error: Platform argument (ios|android) missing."
  exit 1
fi

DOPPLER_SECRET_NAME=""
EXPO_PLATFORM_COMMAND=""

if [ "$PLATFORM" == "ios" ]; then
  DOPPLER_SECRET_NAME="IOS_DEVICE_ID"
  EXPO_PLATFORM_COMMAND="ios"
elif [ "$PLATFORM" == "android" ]; then
  DOPPLER_SECRET_NAME="ANDROID_DEVICE_ID"
  EXPO_PLATFORM_COMMAND="android"
else
  echo "Error: Invalid platform '$PLATFORM'. Use 'ios' or 'android'."
  exit 1
fi

echo "Fetching $PLATFORM device ID from Doppler ($DOPPLER_SECRET_NAME)..."
DEVICE_ID=$(doppler run -- doppler secrets get "$DOPPLER_SECRET_NAME" --plain 2>/dev/null)

if [ -n "$DEVICE_ID" ]; then
  echo "Found device ID: $DEVICE_ID. Running on $PLATFORM device..."
  APP_VARIANT=development doppler run -- npx expo run:"$EXPO_PLATFORM_COMMAND" --device "$DEVICE_ID"
else
  echo "No device ID found in Doppler for $DOPPLER_SECRET_NAME. Falling back to interactive $PLATFORM device selection."
  APP_VARIANT=development doppler run -- npx expo run:"$EXPO_PLATFORM_COMMAND" --device
fi