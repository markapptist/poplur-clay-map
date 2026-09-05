// The three BUSINESS testers' opening content, seeded as real posts so they
// stand on the map and in the feed from the moment they are provisioned —
// the same way the five person testers were given approved media.
//
// Media comes ONLY from the licensed asset pack (the set the feed, the
// official posts and fix-beta-runner-media.mjs all draw on), matched to each
// business's own channel — never generated, never unapproved, per the
// standing lab-media rule. The photo cards carry a like count printed in the
// artwork, so likeCount MATCHES THE CARD (demoFeedMedia.ts: a card reading
// 15.2K under a counter saying anything else looks broken); videos print
// nothing and start at zero.
//
// Reach is the business's earned radius at its seat (2–3 km, like a person
// tester's seed), not a boost: nothing here pays for reach. In test mode the
// cohort reaches everyone regardless (syntheticBeta on the row).
//
// Owner is the business account (UID === actorId, provisioned by
// functions/scripts/provisionSyntheticBetaAccounts.js); the byline is the
// business handle. Doc ids are deterministic, so reruns skip existing posts.
// Tagged as cohort residue (syntheticBeta/cohortId/source), NOT officialContent.
import { execFileSync } from 'node:child_process'
const FS = 'https://firestore.googleapis.com/v1/projects/poplur2025/databases/(default)/documents'
const PACK = 'https://storage.googleapis.com/poplur2025-assets/asset-packs/feed'
const COHORT_ID = 'beta-browser-v1'

// Seats mirror functions/src/syntheticBrowserRunner.ts SYNTHETIC_MAP_POST_SEEDS
// and the runner's ACTOR_LOCATIONS. coords are [lng, lat].
const BUSINESSES = [
  {
    actorId: 'sim-biz-food-006', handle: 'nightmarket', name: 'Night Market Eats', channelId: 'food',
    place: 'Toronto', coords: [-79.4005, 43.6545], radiusMeters: 2_600, pinColor: 'orange',
    posts: [
      { id: 'opening-night', file: 'ad-food.mp4', kind: 'video', caption: 'Night market is open — come hungry.' },
      { id: 'tonight-menu', file: 'photos/poplur-food.jpg', kind: 'photo', likeCount: 11_200, caption: 'Tonight\'s menu, straight off the grill.' },
    ],
  },
  {
    actorId: 'sim-biz-shop-007', handle: 'hauls.to', name: 'Hauls Outlet', channelId: 'shopping',
    place: 'Toronto', coords: [-79.3807, 43.6544], radiusMeters: 2_300, pinColor: 'purple',
    posts: [
      { id: 'weekend-drop', file: 'ad-shopping.mp4', kind: 'video', caption: 'Weekend drop just landed at the outlet.' },
      { id: 'new-racks', file: 'photos/poplur-shopping.jpg', kind: 'photo', likeCount: 15_200, caption: 'New racks in. First come, first hauled.' },
      { id: 'womens-floor', file: 'photos/poplur-women.jpg', kind: 'photo', likeCount: 8_300, caption: 'The women\'s floor, restocked this morning.' },
    ],
  },
  {
    actorId: 'sim-biz-fashion-008', handle: 'fitcheck.nyc', name: 'Fit Check Daily', channelId: 'fashion',
    place: 'New York', coords: [-74.003, 40.7233], radiusMeters: 2_800, pinColor: 'blue',
    posts: [
      { id: 'todays-fit', file: 'photos/poplur-clothes.jpg', kind: 'photo', likeCount: 9_800, caption: 'Today\'s fit, checked.' },
      { id: 'window-look', file: 'photos/poplur-fashion.jpg', kind: 'photo', likeCount: 12_700, caption: 'The window look — in store now.' },
    ],
  },
]

const token = execFileSync('gcloud', ['auth', 'application-default', 'print-access-token'], { encoding: 'utf8' }).trim()
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
let created = 0
let existing = 0
let index = 0
for (const business of BUSINESSES) {
  for (const post of business.posts) {
    const postId = `post-biz-${business.actorId}-${post.id}`
    // Spread the timestamps so the feed does not read them as one burst.
    const now = Date.now() - index * 7 * 60_000
    index += 1
    const [lng, lat] = business.coords
    const fields = {
      audience: { stringValue: 'public' },
      status: { stringValue: 'published' },
      visibilityStatus: { stringValue: 'published' },
      channelId: { stringValue: business.channelId },
      caption: { stringValue: post.caption },
      createdAt: { timestampValue: new Date(now).toISOString() },
      createdAtMillis: { integerValue: String(now) },
      latitude: { doubleValue: lat },
      longitude: { doubleValue: lng },
      latitudeCell: { integerValue: String(Math.round(lat * 1000)) },
      longitudeCell: { integerValue: String(Math.round(lng * 1000)) },
      locationVisibility: { stringValue: 'approximate' },
      place: { stringValue: business.place },
      locationName: { stringValue: business.place },
      filterId: { stringValue: 'none' },
      mediaType: { stringValue: post.kind },
      mediaURL: { stringValue: `${PACK}/${post.file}` },
      ...(post.kind === 'video'
        ? { posterURL: { stringValue: `${PACK}/posters/${post.file.replace(/\.mp4$/, '.jpg')}` } }
        : {}),
      radiusMeters: { integerValue: String(business.radiusMeters) },
      radius: { integerValue: String(business.radiusMeters) },
      organicRadiusMeters: { integerValue: String(business.radiusMeters) },
      viewCount: { integerValue: '0' },
      likeCount: { integerValue: String(post.likeCount ?? 0) },
      downvoteCount: { integerValue: '0' },
      commentCount: { integerValue: '0' },
      userID: { stringValue: business.actorId },
      userId: { stringValue: business.actorId },
      username: { stringValue: business.handle },
      displayName: { stringValue: business.name },
      ownerAccountType: { stringValue: 'business' },
      pinColor: { stringValue: business.pinColor },
      syntheticBeta: { booleanValue: true },
      syntheticActorId: { stringValue: business.actorId },
      cohortId: { stringValue: COHORT_ID },
      source: { stringValue: 'synthetic-browser' },
      syntheticSource: { stringValue: 'business-cohort-seed' },
      testOnly: { booleanValue: true },
      rightsAttestationVersion: { stringValue: '2026-08' },
      rightsAttestedAtMillis: { integerValue: String(now) },
      updatedAt: { timestampValue: new Date(now).toISOString() },
    }
    const r = await fetch(`${FS}/posts?documentId=${postId}`, {
      method: 'POST', headers, body: JSON.stringify({ fields }),
    })
    const body = await r.json()
    if (body.name) { created += 1; console.log(`created ${postId}  (${business.place}, @${business.handle}, ${business.channelId})`) }
    else if (body.error?.status === 'ALREADY_EXISTS') { existing += 1; console.log(`exists  ${postId}`) }
    else { console.error(`FAILED ${postId}:`, body.error?.message); process.exit(1) }
  }
}
console.log(`\n${created} created, ${existing} already existed — business testers are posting approved content.`)
