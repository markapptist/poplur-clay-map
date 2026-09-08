// Official Poplur launch content: the 11 licensed demo creatives (the same
// curated set FeedView.swift and demoFeedMedia.ts ship) seeded as REAL posts
// so no fresh user — or App Review — ever meets an empty feed. Apple rejected
// the app as "not complete" because radius-gated delivery means a reviewer
// outside every post's radius sees nothing.
//
// These are seeded official demo posts, not purchased reach. They start at
// worldwide radius and follow ordinary decay. Deterministic document IDs keep
// this provisioning script from refreshing or duplicating existing posts.
import { execFileSync } from 'node:child_process'
const FS = 'https://firestore.googleapis.com/v1/projects/poplur2025/databases/(default)/documents'
const PACK = 'https://storage.googleapis.com/poplur2025-assets/asset-packs/feed'
const OWNER_UID = 'LiEG6SNtKEZN6eEGeybf0afZnHm1' // PoplurTest (the review demo account)
const WORLD = 40_075_000
// Mirrors DEMO_CREATIVES (demoFeedMedia.ts) + each channel's brand handle
// (FeedTwin CHANNELS). coords are [lng, lat].
const CREATIVES = [
  { id: 'food-drive-ad', channelId: 'food', handle: 'sauceboss', file: 'ad-food.mp4', city: 'Tokyo', coords: [139.6503, 35.6762] },
  { id: 'sports-drive-ad', channelId: 'sports', handle: 'pitchside', file: 'ad-sports.mp4', city: 'New York', coords: [-73.9262, 40.8296] },
  { id: 'shopping-drive-ad', channelId: 'shopping', handle: 'hauls', file: 'ad-shopping.mp4', city: 'Toronto', coords: [-79.3807, 43.6544] },
  { id: 'music-drive-ad', channelId: 'music', handle: 'basement.set', file: 'ad-music.mp4', city: 'Los Angeles', coords: [-118.2437, 34.0522] },
  { id: 'cartoon-drive-ad', channelId: 'cartoon', handle: 'doodlecast', file: 'ad-cartoon.mp4', city: 'Burbank', coords: [-118.3534, 34.1381] },
  { id: 'kids-drive-ad', channelId: 'kids', handle: 'playtime', file: 'ad-kids.mp4', city: 'Orlando', coords: [-81.3789, 28.5384] },
  { id: 'comedy-drive-ad', channelId: 'comedy', handle: 'bitmerchant', file: 'ad-comedy.mp4', city: 'Chicago', coords: [-87.6298, 41.8781] },
  { id: 'spanish-drive-ad-1', channelId: 'spanish', handle: 'vibra.cdmx', file: 'ad-spanish-1.mp4', city: 'Madrid', coords: [-3.7038, 40.4168] },
  { id: 'spanish-drive-ad-2', channelId: 'spanish', handle: 'vibra.cdmx', file: 'ad-spanish-2.mp4', city: 'Mexico City', coords: [-99.1332, 19.4326] },
  { id: 'spanish-drive-ad-3', channelId: 'spanish', handle: 'vibra.cdmx', file: 'ad-spanish-3.mp4', city: 'Bogotá', coords: [-74.0721, 4.7110] },
  { id: 'french-drive-ad', channelId: 'french', handle: 'paris.pov', file: 'ad-french.mp4', city: 'Paris', coords: [2.3522, 48.8566] },
]
// Branded photo cards (DEMO_PHOTOS) fill the channels the videos never
// covered — beauty, fashion, news, tech — and 'photo-modelling' rides the
// Milan runway card onto modelling (the same nearest-channel rule the card
// mapping already uses), so only 'live' stays honestly empty ("live in your
// radius" is @you by design). likeCount here MATCHES THE NUMBER PRINTED ON
// THE CARD ARTWORK — demoFeedMedia.ts records that a card reading 15.3K under
// a counter showing anything else looks broken rather than busy. Videos keep
// zeroed counters; nothing is printed on them.
const PHOTOS = [
  { id: 'photo-sports', channelId: 'sports', handle: 'pitchside', file: 'photos/poplur-sports.jpg', city: 'London', coords: [-0.1276, 51.5072], likeCount: 15_300 },
  { id: 'photo-gym', channelId: 'sports', handle: 'pitchside', file: 'photos/poplur-gym.jpg', city: 'Los Angeles', coords: [-118.2437, 34.0522], likeCount: 9_400 },
  { id: 'photo-clothes', channelId: 'fashion', handle: 'fitcheckdaily', file: 'photos/poplur-clothes.jpg', city: 'New York', coords: [-73.9352, 40.7306], likeCount: 9_800 },
  { id: 'photo-fashion', channelId: 'fashion', handle: 'fitcheckdaily', file: 'photos/poplur-fashion.jpg', city: 'Milan', coords: [9.19, 45.4642], likeCount: 12_700 },
  { id: 'photo-modelling', channelId: 'modelling', handle: 'runwayraw', file: 'photos/poplur-fashion.jpg', city: 'Milan', coords: [9.19, 45.4642], likeCount: 12_700 },
  { id: 'photo-music', channelId: 'music', handle: 'basement.set', file: 'photos/poplur-music.jpg', city: 'Los Angeles', coords: [-118.2437, 34.0522], likeCount: 14_600 },
  { id: 'photo-news', channelId: 'news', handle: 'localwire', file: 'photos/poplur-news.jpg', city: 'New York', coords: [-74.006, 40.7128], likeCount: 10_200 },
  { id: 'photo-nature', channelId: 'news', handle: 'localwire', file: 'photos/poplur-nature.jpg', city: 'Banff', coords: [-115.5708, 51.1784], likeCount: 12_600 },
  { id: 'photo-tech', channelId: 'tech', handle: 'shipit', file: 'photos/poplur-tech.jpg', city: 'Tokyo', coords: [139.6503, 35.6762], likeCount: 13_400 },
  { id: 'photo-cars', channelId: 'tech', handle: 'shipit', file: 'photos/poplur-cars.jpg', city: 'Chicago', coords: [-87.6298, 41.8781], likeCount: 10_800 },
  { id: 'photo-kids', channelId: 'kids', handle: 'playtime', file: 'photos/poplur-kids.jpg', city: 'Orlando', coords: [-81.3789, 28.5384], likeCount: 12_900 },
  { id: 'photo-shopping', channelId: 'shopping', handle: 'hauls', file: 'photos/poplur-shopping.jpg', city: 'Toronto', coords: [-79.3807, 43.6544], likeCount: 15_200 },
  { id: 'photo-women', channelId: 'shopping', handle: 'hauls', file: 'photos/poplur-women.jpg', city: 'Paris', coords: [2.3522, 48.8566], likeCount: 8_300 },
  { id: 'photo-comedy', channelId: 'comedy', handle: 'bitmerchant', file: 'photos/poplur-comedy.jpg', city: 'Chicago', coords: [-87.6298, 41.8781], likeCount: 9_700 },
  { id: 'photo-french', channelId: 'french', handle: 'paris.pov', file: 'photos/poplur-french.jpg', city: 'Paris', coords: [2.3522, 48.8566], likeCount: 10_600 },
  { id: 'photo-spanish', channelId: 'spanish', handle: 'vibra.cdmx', file: 'photos/poplur-spanish.jpg', city: 'Mexico City', coords: [-99.1332, 19.4326], likeCount: 11_300 },
  { id: 'photo-selfies', channelId: 'beauty', handle: 'glowgetter', file: 'photos/poplur-selfies.jpg', city: 'Toronto', coords: [-79.3832, 43.6532], likeCount: 15_700 },
  { id: 'photo-food', channelId: 'food', handle: 'sauceboss', file: 'photos/poplur-food.jpg', city: 'Toronto', coords: [-79.4005, 43.6547], likeCount: 11_200 },
]
const token = execFileSync('gcloud', ['auth', 'application-default', 'print-access-token'], { encoding: 'utf8' }).trim()
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
let created = 0
let existing = 0
const ALL = [
  ...CREATIVES.map(creative => ({ ...creative, kind: 'video' })),
  ...PHOTOS.map(photo => ({ ...photo, kind: 'photo' })),
]
for (const [index, creative] of ALL.entries()) {
  const postId = `post-official-${creative.id}`
  const now = Date.now() - index * 60_000
  const [lng, lat] = creative.coords
  const fields = {
    audience: { stringValue: 'public' },
    channelId: { stringValue: creative.channelId },
    createdAt: { timestampValue: new Date(now).toISOString() },
    createdAtMillis: { integerValue: String(now) },
    latitude: { doubleValue: lat },
    longitude: { doubleValue: lng },
    latitudeCell: { integerValue: String(Math.round(lat * 1000)) },
    longitudeCell: { integerValue: String(Math.round(lng * 1000)) },
    locationVisibility: { stringValue: 'approximate' },
    filterId: { stringValue: 'none' },
    mediaType: { stringValue: creative.kind },
    mediaURL: { stringValue: `${PACK}/${creative.file}` },
    ...(creative.kind === 'video'
      ? { posterURL: { stringValue: `${PACK}/posters/${creative.file.replace(/\.mp4$/, '.jpg')}` } }
      : {}),
    place: { stringValue: creative.city },
    radiusMeters: { integerValue: String(WORLD) },
    radius: { integerValue: String(WORLD) },
    organicRadiusMeters: { integerValue: String(WORLD) },
    boostedRadiusMeters: { integerValue: '0' },
    decayedAt: { timestampValue: new Date(now).toISOString() },
    viewCount: { integerValue: '0' },
    likeCount: { integerValue: String(creative.likeCount ?? 0) },
    downvoteCount: { integerValue: '0' },
    commentCount: { integerValue: '0' },
    userID: { stringValue: OWNER_UID },
    username: { stringValue: creative.handle },
    officialContent: { booleanValue: true },
    rightsAttestationVersion: { stringValue: '2026-08' },
    rightsAttestedAtMillis: { integerValue: String(now) },
    updatedAt: { timestampValue: new Date(now).toISOString() },
  }
  const r = await fetch(`${FS}/posts?documentId=${postId}`, {
    method: 'POST', headers, body: JSON.stringify({ fields }),
  })
  const body = await r.json()
  if (body.name) { created += 1; console.log(`created ${postId}  (${creative.city}, @${creative.handle})`) }
  else if (body.error?.status === 'ALREADY_EXISTS') { existing += 1; console.log(`exists  ${postId}`) }
  else { console.error(`FAILED ${postId}:`, body.error?.message); process.exit(1) }
}
console.log(`\n${created} created, ${existing} already existed — seeded reach follows normal radius decay.`)
