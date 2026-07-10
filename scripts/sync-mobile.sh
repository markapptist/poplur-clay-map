#!/bin/bash
# Builds the clay map and copies the bundle into the iOS and Android apps.
# The sprite GLBs (car/plane/boat/palm, ~140MB) are excluded — the map falls
# back to its SVG props on mobile. cube.glb ships (the swipeable home cube).
set -euo pipefail

cd "$(dirname "$0")/.."

IOS_DEST="/Users/matrix/Developer/Poplur2025-iOS/Poplur2025/ClayMapWeb"
ANDROID_DEST="/Users/matrix/Developer/Poplur2025-Android/app/src/main/assets/claymap"

npm run build

sync_to() {
  local dest="$1"
  rm -rf "$dest"
  mkdir -p "$dest"
  rsync -a --exclude 'models/' dist/ "$dest/"
}

sync_to "$IOS_DEST"
sync_to "$ANDROID_DEST"

echo "Synced clay map bundle:"
du -sh "$IOS_DEST" "$ANDROID_DEST"
