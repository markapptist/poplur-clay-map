#!/bin/bash
# Builds the clay map and copies the bundle into the iOS and Android apps.
# The sprite GLBs (car/plane/boat/palm, ~140MB) are excluded — the map falls
# back to its SVG props on mobile. cube.glb ships (the swipeable home cube).
set -euo pipefail

cd "$(dirname "$0")/.."

IOS_DEST="/Users/matrix/Developer/Poplur2025-iOS/ClayMapWeb"
ANDROID_DEST="/Users/matrix/Developer/Poplur2025-Android/app/src/main/assets/claymap"
RN_DEST="/Users/matrix/Developer/Poplur2025-ReactNative/src/assets/claymap/claymap.zip"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/poplur-mobile-dist.XXXXXX")"
trap 'rm -rf "$BUILD_DIR"' EXIT

# `dist/` is also rebuilt by the persistent preview watcher. Copying directly
# from it can race a second Vite build: Vite clears the directory first and
# rsync then ships a partially missing app. Build this release into an isolated
# directory and keep that exact snapshot for every downstream target.
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vite build --outDir "$BUILD_DIR"

sync_to() {
  local dest="$1"
  mkdir -p "$dest"
  rm -rf "$dest/models"
  rsync -a --delete --exclude 'models/' "$BUILD_DIR/" "$dest/"
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
  cd "$BUILD_DIR"
  zip -qr "$RN_DEST" . -x 'models/*'
)
unzip -tq "$RN_DEST" >/dev/null

echo "Synced clay map bundle:"
du -sh "$IOS_DEST" "$ANDROID_DEST" "$RN_DEST"
