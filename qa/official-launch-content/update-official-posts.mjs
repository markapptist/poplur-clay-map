// Rework the official posts' reach and dress: the review-era "everything at
// world radius" read as unrealistic on the live map. Four anchors — one per
// broad region — stay at the Earth-radius ceiling (the clients treat the
// ceiling as reaching everyone, which is what keeps App Review's feed full
// anywhere on the planet); every other post drops to the city-scale radius
// its creative was DESIGNED with (demoFeedMedia.ts DEMO_CREATIVES /
// DEMO_PHOTOS). Reach still ships as permanent boost, so radiusDecay keeps
// ignoring these. Each post also gains one of the five supplied clay pin
// colours so the takeover terrain paints varied colour across the map.
import { execFileSync } from 'node:child_process'
const FS = 'https://firestore.googleapis.com/v1/projects/poplur2025/databases/(default)/documents'
const CEILING = 6_371_000 // Earth's radius — the new scale top (clay-map c9de872)
// Region anchors held at the ceiling: US-East, US-West, Europe, Asia.
const WORLD_ANCHORS = new Set([
  'post-official-sports-drive-ad',   // New York
  'post-official-music-drive-ad',    // Los Angeles
  'post-official-french-drive-ad',   // Paris
  'post-official-food-drive-ad',     // Tokyo
])
// Designed radii from demoFeedMedia.ts, metres. Colour rotation covers all
// five supplied pins; anchors wear red/purple/blue/green so the biggest
// terrain washes differ most.
const POSTS = [
  ['post-official-food-drive-ad', 135_000, 'red'],
  ['post-official-sports-drive-ad', 160_000, 'purple'],
  ['post-official-shopping-drive-ad', 125_000, 'blue'],
  ['post-official-music-drive-ad', 150_000, 'green'],
  ['post-official-cartoon-drive-ad', 118_000, 'orange'],
  ['post-official-kids-drive-ad', 110_000, 'red'],
  ['post-official-comedy-drive-ad', 120_000, 'purple'],
  ['post-official-spanish-drive-ad-1', 130_000, 'blue'],
  ['post-official-spanish-drive-ad-2', 140_000, 'green'],
  ['post-official-spanish-drive-ad-3', 120_000, 'orange'],
  ['post-official-french-drive-ad', 130_000, 'red'],
  ['post-official-photo-sports', 153_000, 'green'],
  ['post-official-photo-gym', 94_000, 'orange'],
  ['post-official-photo-clothes', 98_000, 'red'],
  ['post-official-photo-fashion', 127_000, 'purple'],
  ['post-official-photo-modelling', 127_000, 'blue'],
  ['post-official-photo-music', 146_000, 'orange'],
  ['post-official-photo-news', 102_000, 'red'],
  ['post-official-photo-nature', 126_000, 'green'],
  ['post-official-photo-tech', 134_000, 'purple'],
  ['post-official-photo-cars', 108_000, 'blue'],
  ['post-official-photo-kids', 129_000, 'green'],
  ['post-official-photo-shopping', 152_000, 'orange'],
  ['post-official-photo-women', 83_000, 'purple'],
  ['post-official-photo-comedy', 97_000, 'red'],
  ['post-official-photo-french', 106_000, 'blue'],
  ['post-official-photo-spanish', 113_000, 'green'],
  ['post-official-photo-selfies', 157_000, 'purple'],
  ['post-official-photo-food', 112_000, 'orange'],
]
const token = execFileSync('gcloud', ['auth', 'application-default', 'print-access-token'], { encoding: 'utf8' }).trim()
let updated = 0
for (const [postId, designedMeters, pinColor] of POSTS) {
  const radius = WORLD_ANCHORS.has(postId) ? CEILING : designedMeters
  const mask = ['radiusMeters', 'radius', 'boostedRadiusMeters', 'organicRadiusMeters', 'pinColor']
    .map(f => `updateMask.fieldPaths=${f}`).join('&')
  const r = await fetch(`${FS}/posts/${postId}?${mask}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: {
      radiusMeters: { integerValue: String(radius) },
      radius: { integerValue: String(radius) },
      boostedRadiusMeters: { integerValue: String(radius) },
      organicRadiusMeters: { integerValue: '0' },
      pinColor: { stringValue: pinColor },
    } }),
  })
  if (!r.ok) { console.error(`FAILED ${postId}: ${r.status}`); process.exit(1) }
  updated += 1
  console.log(`${postId}: ${WORLD_ANCHORS.has(postId) ? 'WORLD ceiling' : `${(radius / 1000).toFixed(0)} km`} · pin ${pinColor}`)
}
console.log(`\n${updated} official posts updated — 4 world anchors, ${updated - 4} city-scale, five pin colours in rotation.`)
