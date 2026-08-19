#!/usr/bin/env bash
# Upload the built packs to Cloud Storage.
#
# Separate from the build on purpose: this is the step that changes what every
# installed copy of the app fetches, so it should be run deliberately rather
# than as a side effect of building.
set -euo pipefail

BUCKET="${POPLUR_PACK_BUCKET:-poplur2025.firebasestorage.app}"
PREFIX="asset-packs"

[ -d dist-packs ] || { echo "dist-packs/ missing — run: npm run build-packs"; exit 1; }
command -v gsutil >/dev/null || { echo "gsutil not found. Install the Google Cloud SDK, then: gcloud auth login"; exit 1; }

echo "Publishing to gs://$BUCKET/$PREFIX"
du -sh dist-packs | sed 's/^/  /'
read -r -p "Continue? [y/N] " reply
[ "$reply" = "y" ] || { echo "cancelled"; exit 0; }

# -m parallelises; -r recurses. Cache headers matter: packs are versioned in the
# manifest, so a long max-age is safe and keeps repeat installs off the network.
gsutil -m -h "Cache-Control:public, max-age=31536000, immutable" \
  cp -r dist-packs/* "gs://$BUCKET/$PREFIX/"

echo
echo "Published. The bucket must allow public reads for the app to fetch them:"
echo "  gsutil iam ch allUsers:objectViewer gs://$BUCKET"
