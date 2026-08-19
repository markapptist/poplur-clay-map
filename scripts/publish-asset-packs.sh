#!/usr/bin/env bash
# Upload the built packs to Cloud Storage.
#
# Separate from the build on purpose: this is the step that changes what every
# installed copy of the app fetches, so it should be run deliberately rather
# than as a side effect of building.
set -euo pipefail

BUCKET="${POPLUR_PACK_BUCKET:-poplur2025-assets}"
PREFIX="asset-packs"

[ -d dist-packs ] || { echo "dist-packs/ missing — run: npm run build-packs"; exit 1; }
command -v gsutil >/dev/null || { echo "gsutil not found. Install the Google Cloud SDK, then: gcloud auth login"; exit 1; }

echo "Publishing to gs://$BUCKET/$PREFIX"
du -sh dist-packs | sed 's/^/  /'
read -r -p "Continue? [y/N] " reply
case "$reply" in
  [yY]|[yY][eE][sS]) ;;
  *) echo "cancelled"; exit 1 ;;      # non-zero, so a && chain stops here
esac

# Create the bucket on first publish rather than failing with a raw gsutil error.
if ! gsutil ls -b "gs://$BUCKET" >/dev/null 2>&1; then
  echo "Bucket gs://$BUCKET does not exist."
  read -r -p "Create it in us-central1? [y/N] " mk
  case "$mk" in
    [yY]|[yY][eE][sS]) gsutil mb -l us-central1 "gs://$BUCKET" ;;
    *) echo "cancelled"; exit 1 ;;
  esac
fi

# -m parallelises; -r recurses. Cache headers matter: packs are versioned in the
# manifest, so a long max-age is safe and keeps repeat installs off the network.
gsutil -m -h "Cache-Control:public, max-age=31536000, immutable" \
  cp -r dist-packs/* "gs://$BUCKET/$PREFIX/"

echo
echo "Published."
echo
echo "This bucket must allow public reads. It is deliberately NOT the app's"
echo "default bucket: that one holds user profile pictures and selfie videos,"
echo "and opening it to serve game art would expose all of them."
echo
echo "  gsutil mb -l us-central1 gs://$BUCKET          # once, if it does not exist"
echo "  gsutil iam ch allUsers:objectViewer gs://$BUCKET"
