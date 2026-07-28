#!/bin/bash
# Builds the clay map and copies the bundle into the iOS and Android apps.
# The sprite GLBs (car/plane/boat/palm, ~140MB) are excluded — the map falls
# back to its SVG props on mobile. cube.glb ships (the swipeable home cube).
set -euo pipefail

cd "$(dirname "$0")/.."

IOS_DEST="/Users/matrix/Developer/Poplur2025-iOS/ClayMapWeb"
ANDROID_DEST="/Users/matrix/Developer/Poplur2025-Android/app/src/main/assets/claymap"
RN_DEST="/Users/matrix/Developer/Poplur2025-ReactNative/src/assets/claymap/claymap.zip"

npm run build

sync_to() {
  local dest="$1"
  mkdir -p "$dest"
  rm -rf "$dest/models"
  rsync -a --delete --exclude 'models/' dist/ "$dest/"
  rm -rf "$dest/models"
  shasum -a 256 public/logo_icon.png "$dest/logo_icon.png" | awk 'NR == 1 { expected = $1 } NR == 2 && $1 != expected { exit 1 }'
}

sync_to "$IOS_DEST"
sync_to "$ANDROID_DEST"

# React Native serves the same Vite bundle from a loopback static server. Keep
# its archive in this release path too; omitting it was why the RN device could
# keep opening an older home/subscreen build after iOS and Android had moved on.
rm -f "$RN_DEST"
(
  cd dist
  zip -qr "$RN_DEST" . -x 'models/*'
)
unzip -tq "$RN_DEST" >/dev/null

echo "Synced clay map bundle:"
du -sh "$IOS_DEST" "$ANDROID_DEST" "$RN_DEST"
