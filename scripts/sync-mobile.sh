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

IOS_DEST="${POPLUR_IOS_BUNDLE_DEST:-/Users/matrix/Developer/Poplur2025-iOS/ClayMapWeb}"
ANDROID_DEST="${POPLUR_ANDROID_BUNDLE_DEST:-/Users/matrix/Developer/Poplur2025-Android/app/src/main/assets/claymap}"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/poplur-mobile-dist.XXXXXX")"
PUBLISH_LOCK="${TMPDIR:-/tmp}/poplur-mobile-sync.lock"
GATE_SERVER_LOG="$(mktemp "${TMPDIR:-/tmp}/poplur-gate-server.log.XXXXXX")"
GATE_SERVER_PID=""
LOCK_HELD=0

cleanup() {
  if [[ -n "$GATE_SERVER_PID" ]]; then kill "$GATE_SERVER_PID" 2>/dev/null || true; fi
  rm -f "$GATE_SERVER_LOG"
  rm -rf "$BUILD_DIR"
  # A queued release may acquire the same directory immediately after this
  # process stops owning it. Never let a late cleanup remove that newer
  # owner's lock.
  if [[ "$LOCK_HELD" -eq 1 && -f "$PUBLISH_LOCK/pid" ]] \
    && [[ "$(<"$PUBLISH_LOCK/pid")" == "$$" ]]; then
    rm -rf "$PUBLISH_LOCK"
  fi
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
node scripts/verify-tab-model-quality.mjs
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vite build --outDir "$BUILD_DIR"
# Source models are never shipped. Feed and channel artwork are core UI and
# now stay bundled, so a storage outage cannot remove whole screen assets.
# The thermal gate measures the exact snapshot that every device receives.
rm -rf "$BUILD_DIR/models"

# A detached/clean release worktree can contain raw Git LFS pointer text when
# the corresponding object has not been hydrated locally. Vite copies those
# tiny files without complaint, producing a valid-looking bundle whose models
# fail only on device. Reject every leaked pointer before the thermal gate or
# any downstream destination is touched.
LFS_POINTER="$(find "$BUILD_DIR" -type f -size -256c \
  -exec grep -IlF 'version https://git-lfs.github.com/spec/v1' {} + \
  | head -n 1 || true)"
if [[ -n "$LFS_POINTER" ]]; then
  echo "Mobile release verification failed: Git LFS pointer leaked into $LFS_POINTER." >&2
  echo "Hydrate the release worktree's LFS objects, then rerun the guarded sync." >&2
  exit 1
fi

# The source models tree is deliberately excluded above, but Wardrobe's five
# compact runtime GLBs live outside it and are required on every phone. Fail
# closed here so a packaging change cannot silently ship the exact
# "3D avatar could not load" screen again.
WARDROBE_ASSETS=(
  wardrobe-models/Poplur_Male_Morph.glb
  wardrobe-models/Poplur_Female_Morph.glb
  wardrobe-models/Hair_Long.glb
  wardrobe-models/Hair_BuzzedFemale.glb
  wardrobe-models/Hair_SimpleParted.glb
  wardrobe-models/Poplur_Atelier_Jacket_Female.glb
  wardrobe-models/Poplur_Atelier_Jacket_Male.glb
  wardrobe-models/Poplur_Atelier_Trousers_Female.glb
  wardrobe-models/Poplur_Atelier_Trousers_Male.glb
)
FEED_SIDE_ICON_ASSETS=(
  poplur-side-buttons/assets/256/feed/mute.png
  poplur-side-buttons/assets/256/feed/share.png
  poplur-side-buttons/assets/256/feed/captions.png
  poplur-side-buttons/assets/256/feed/comments_collapse.png
  poplur-side-buttons/assets/256/feed/comment.png
  poplur-side-buttons/assets/256/feed/like.png
  poplur-side-buttons/assets/256/feed/dislike.png
  poplur-side-buttons/assets/512/feed/mute.png
  poplur-side-buttons/assets/512/feed/share.png
  poplur-side-buttons/assets/512/feed/captions.png
  poplur-side-buttons/assets/512/feed/comments_collapse.png
  poplur-side-buttons/assets/512/feed/comment.png
  poplur-side-buttons/assets/512/feed/like.png
  poplur-side-buttons/assets/512/feed/dislike.png
)
verify_wardrobe_assets() {
  local root="$1"
  local asset
  local paths=()
  for asset in "${WARDROBE_ASSETS[@]}"; do
    if [[ ! -s "$root/$asset" ]]; then
      echo "Mobile release verification failed: missing $asset in $root." >&2
      exit 1
    fi
    paths+=("$root/$asset")
  done
  node --input-type=module - "${paths[@]}" <<'NODE'
import fs from 'node:fs'

for (const path of process.argv.slice(2)) {
  const bytes = fs.readFileSync(path)
  const fail = reason => {
    console.error(`Mobile release verification failed: invalid GLB ${path}: ${reason}.`)
    process.exit(1)
  }
  if (bytes.length < 12) fail('file is shorter than the 12-byte header')
  if (bytes.toString('ascii', 0, 4) !== 'glTF') fail('header magic is not glTF')
  if (bytes.readUInt32LE(4) !== 2) fail(`unsupported version ${bytes.readUInt32LE(4)}`)
  const declaredLength = bytes.readUInt32LE(8)
  if (declaredLength !== bytes.length) {
    fail(`header declares ${declaredLength} bytes but file contains ${bytes.length}`)
  }
}
NODE
}
verify_wardrobe_assets "$BUILD_DIR"
verify_feed_side_icons() {
  local root="$1"
  local asset
  for asset in "${FEED_SIDE_ICON_ASSETS[@]}"; do
    if [[ ! -s "$root/$asset" ]]; then
      echo "Mobile release verification failed: missing Feed side icon $asset in $root." >&2
      exit 1
    fi
  done
}
verify_feed_side_icons "$BUILD_DIR"
# ripgrep is not installed on every machine that runs this script; fall back
# to plain grep for the same fixed-string check rather than failing the
# release with a misleading "token was not embedded" error.
js_contains() {
  if command -v rg >/dev/null 2>&1; then
    rg -l --glob '*.js' --fixed-strings -- "$1" "$2" >/dev/null
  else
    grep -rlF --include='*.js' -- "$1" "$2" >/dev/null
  fi
}
if ! js_contains '/wardrobe-models/' "$BUILD_DIR"; then
  echo "Mobile release verification failed: compiled JavaScript does not reference /wardrobe-models/." >&2
  exit 1
fi
if js_contains '/models/avatars/quaternius/' "$BUILD_DIR"; then
  echo "Mobile release verification failed: compiled JavaScript still references the excluded wardrobe model root." >&2
  exit 1
fi
if ! js_contains "$VITE_MAPBOX_TOKEN" "$BUILD_DIR"; then
  echo "Mobile release verification failed: Mapbox token was not embedded." >&2
  exit 1
fi
if js_contains 'Add VITE_MAPBOX_TOKEN' "$BUILD_DIR"; then
  echo "Mobile release verification failed: missing-token UI survived production build." >&2
  exit 1
fi

# Measure and publish as one serialized release transaction. Running several
# Chromium thermal probes at once makes otherwise-idle pages miss their park
# acknowledgement and turns machine contention into an "unmeasurable" failure.
# Holding the existing lock through both phases also prevents a newer snapshot
# from being measured first and then overwritten by an older queued publish.
acquire_publish_lock

# Thermal gate: EVERY build re-measures the surfaces that have burned the
# phone before (running infinite animations, idle long tasks, WebGL contexts,
# running AudioContexts, playing videos — headless, in the device's tier) and
# a regression against .codex/thermal-budgets.json aborts the publish. Raising
# a budget is a deliberate edit shipped with the feature that needs the heat.
# POPLUR_THERMAL_SKIP=1 skips in an emergency, loudly.
#
# The gate must measure THIS snapshot, not the persistent dev server: gating
# on 5199 meant any concurrent editing session's HMR orphaned rAF loops and
# WebGL contexts on the measured pages (canvases read 7 where the shipped
# page owns 4) and home/feed billed 320–420ms of foreign dev-page work
# against their 250ms budgets — the gate failed closed on builds that had
# not changed. Serve the exact bytes being published on a throwaway loopback
# port instead. An explicitly exported POPLUR_THERMAL_BASE still wins, for
# deliberate ad-hoc runs against another target.
start_gate_server() {
  local attempt port probe
  for attempt in 1 2 3 4 5; do
    port=$((49152 + RANDOM % 16000))
    if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then continue; fi
    ./node_modules/.bin/vite preview --outDir "$BUILD_DIR" \
      --host 127.0.0.1 --port "$port" --strictPort --logLevel warn \
      >>"$GATE_SERVER_LOG" 2>&1 &
    GATE_SERVER_PID=$!
    for ((probe = 0; probe < 40; probe++)); do
      if curl -sf -o /dev/null "http://127.0.0.1:${port}/"; then
        GATE_BASE="http://127.0.0.1:${port}"
        return 0
      fi
      if ! kill -0 "$GATE_SERVER_PID" 2>/dev/null; then GATE_SERVER_PID=""; break; fi
      sleep 0.25
    done
    if [[ -n "$GATE_SERVER_PID" ]]; then
      kill "$GATE_SERVER_PID" 2>/dev/null || true
      wait "$GATE_SERVER_PID" 2>/dev/null || true
      GATE_SERVER_PID=""
    fi
  done
  return 1
}

if [[ "${POPLUR_THERMAL_SKIP:-}" == "1" || -n "${POPLUR_THERMAL_BASE:-}" ]]; then
  # The emergency skip prints its own loud warning; an explicit base is a
  # deliberate ad-hoc target. Neither needs the snapshot server.
  node /Users/matrix/Developer/.codex/thermal-gate.mjs
else
  GATE_BASE=""
  if ! start_gate_server; then
    echo "Mobile release failed: could not serve the built snapshot for the thermal gate." >&2
    cat "$GATE_SERVER_LOG" >&2 || true
    exit 1
  fi
  # POPLUR_THERMAL_REQUIRE=1: this path owns the server the gate measures, so
  # an unreachable base is a release failure, never a silent unmeasured pass.
  POPLUR_THERMAL_BASE="$GATE_BASE" POPLUR_THERMAL_REQUIRE=1 \
    node /Users/matrix/Developer/.codex/thermal-gate.mjs
  kill "$GATE_SERVER_PID" 2>/dev/null || true
  wait "$GATE_SERVER_PID" 2>/dev/null || true
  GATE_SERVER_PID=""
fi

# The release lock was acquired before the thermal gate, so the snapshot being
# copied here is still the most recently verified release transaction.

sync_to() {
  local dest="$1"
  mkdir -p "$dest"
  # rsync protects excluded paths from --delete, so clear any copies left by
  # an older sync both before and after publishing the new snapshot.
  rm -rf "$dest/models"
  # Only authoring models are excluded. Core Feed/channel assets must match
  # the local paths in the shipped asset manifest.
  rsync -a --delete \
    --exclude '/models/' \
    "$BUILD_DIR/" "$dest/"
  rm -rf "$dest/models"
  verify_wardrobe_assets "$dest"
  verify_feed_side_icons "$dest"
  shasum -a 256 public/logo_icon.png "$dest/logo_icon.png" | awk 'NR == 1 { expected = $1 } NR == 2 && $1 != expected { exit 1 }'
}

sync_to "$IOS_DEST"
sync_to "$ANDROID_DEST"

# The workspace release policy excludes Expo/React Native on every platform.
echo "Synced native clay map bundles:"
du -sh "$IOS_DEST" "$ANDROID_DEST"
