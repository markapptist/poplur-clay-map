#!/bin/bash
# Builds the clay map and copies the bundle into the iOS and Android apps.
# The sprite GLBs (car/plane/boat/palm, ~140MB) are excluded — the map falls
# back to its SVG props on mobile. cube.glb ships (the swipeable home cube).
set -euo pipefail

cd "$(dirname "$0")/.."

# Vite replaces import.meta.env values at compile time. `.env` is intentionally
# ignored by Git, so a clean release worktree must receive its env file
# explicitly. Fail closed here rather than shipping the developer-only
# missing-token screen to a device again.
BUILD_ENV_FILE="${POPLUR_BUILD_ENV_FILE:-.env}"
if [[ -z "${VITE_MAPBOX_TOKEN:-}" && -f "$BUILD_ENV_FILE" ]]; then
  VITE_MAPBOX_TOKEN="$(sed -n 's/^VITE_MAPBOX_TOKEN=//p' "$BUILD_ENV_FILE" | head -n 1 | tr -d '\r')"
fi
if [[ ! "${VITE_MAPBOX_TOKEN:-}" =~ ^pk\. ]]; then
  echo "Mobile release requires a valid VITE_MAPBOX_TOKEN; set it or provide POPLUR_BUILD_ENV_FILE." >&2
  exit 1
fi
export VITE_MAPBOX_TOKEN

IOS_DEST="/Users/matrix/Developer/Poplur2025-iOS/ClayMapWeb"
ANDROID_DEST="/Users/matrix/Developer/Poplur2025-Android/app/src/main/assets/claymap"
RN_DEST="/Users/matrix/Developer/Poplur2025-ReactNative/src/assets/claymap/claymap.zip"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/poplur-mobile-dist.XXXXXX")"
PUBLISH_LOCK="${TMPDIR:-/tmp}/poplur-mobile-sync.lock"
RN_TMP="$(mktemp "${TMPDIR:-/tmp}/poplur-claymap.zip.XXXXXX")"
LOCK_HELD=0

cleanup() {
  rm -rf "$BUILD_DIR"
  rm -f "$RN_TMP"
  if [[ "$LOCK_HELD" -eq 1 ]]; then rm -rf "$PUBLISH_LOCK"; fi
}
trap cleanup EXIT INT TERM

acquire_publish_lock() {
  while ! mkdir "$PUBLISH_LOCK" 2>/dev/null; do
    # Recover a lock left behind only when its owning process no longer exists.
    if [[ -f "$PUBLISH_LOCK/pid" ]]; then
      local owner
      owner="$(<"$PUBLISH_LOCK/pid")"
      if [[ ! "$owner" =~ ^[0-9]+$ ]] || ! kill -0 "$owner" 2>/dev/null; then
        rm -rf "$PUBLISH_LOCK"
        continue
      fi
    fi
    sleep 0.25
  done
  printf '%s\n' "$$" > "$PUBLISH_LOCK/pid"
  LOCK_HELD=1
}

# `dist/` is also rebuilt by the persistent preview watcher. Copying directly
# from it can race a second Vite build: Vite clears the directory first and
# rsync then ships a partially missing app. Build this release into an isolated
# directory and keep that exact snapshot for every downstream target.
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vite build --outDir "$BUILD_DIR"
if ! rg -l --glob '*.js' --fixed-strings "$VITE_MAPBOX_TOKEN" "$BUILD_DIR" >/dev/null; then
  echo "Mobile release verification failed: Mapbox token was not embedded." >&2
  exit 1
fi
if rg -l --glob '*.js' --fixed-strings 'Add VITE_MAPBOX_TOKEN' "$BUILD_DIR" >/dev/null; then
  echo "Mobile release verification failed: missing-token UI survived production build." >&2
  exit 1
fi

# Watchers can legitimately queue more than one isolated build. Serialize the
# short publish phase so rsync --delete and the RN archive replacement cannot
# interleave two otherwise-valid snapshots.
acquire_publish_lock

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
rm -f "$RN_TMP"
(
  cd "$BUILD_DIR"
  zip -qr "$RN_TMP" . -x 'models/*'
)
unzip -tq "$RN_TMP" >/dev/null
mv -f "$RN_TMP" "$RN_DEST"

echo "Synced clay map bundle:"
du -sh "$IOS_DEST" "$ANDROID_DEST" "$RN_DEST"
