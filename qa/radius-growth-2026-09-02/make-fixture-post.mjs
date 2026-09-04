// Phase 1 fixture: one radius-0 public post at the deterministic browser
// preview origin, owned by the shared-journey account, media copied from the
// approved demo creative (a real playbackURL/mediaURL — seeded "" drops the
// post from the native feed path). Admin-path REST write: rules deny client
// radius writes, fixtures are seeded with the same ADC that reads them.
import { execFileSync } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'
const PROJECT = 'poplur2025'
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`
const TEMPLATE_POST = 'post-03d39e1a-f199-4b18-b802-6f7ac0abfba0'
const OWNER_UID = 'n1BkpZPv4HcBKLAG7FXQTzYp7sF2'
const OWNER_USERNAME = 'shared.first.user.mtive6bz-a9033d3878'
// The browser preview's deterministic viewer fix ([-79.3811, 43.6487]) — by
// default the fixture sits ON the viewer, so it is in radius even at 0 m.
// An optional argument offsets it north (km) to start OUTSIDE the viewer's
// reach for ghost-flip testing: `node make-fixture-post.mjs 4.2`.
const NORTH_KM = Number(process.argv[2] ?? 0) || 0
const LAT = 43.6487 + (NORTH_KM * 1000) / 111_320
const LNG = -79.3811
const token = execFileSync('gcloud', ['auth', 'application-default', 'print-access-token'], { encoding: 'utf8' }).trim()
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const template = await (await fetch(`${FS}/posts/${TEMPLATE_POST}`, { headers })).json()
if (!template.fields) { console.error('template post missing', template); process.exit(1) }
const copy = key => template.fields[key]
const now = Date.now()
const postId = `post-radius-growth-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 8)}`
const fields = {
  audience: { stringValue: 'public' },
  channelId: copy('channelId'),
  createdAt: { timestampValue: new Date(now).toISOString() },
  createdAtMillis: { integerValue: String(now) },
  latitude: { doubleValue: LAT },
  longitude: { doubleValue: LNG },
  latitudeCell: { integerValue: String(Math.round(LAT * 1000)) },
  longitudeCell: { integerValue: String(Math.round(LNG * 1000)) },
  locationVisibility: { stringValue: 'approximate' },
  filterId: { stringValue: 'none' },
  mediaType: copy('mediaType'),
  mediaURL: copy('mediaURL'),
  posterURL: copy('posterURL'),
  mediaStoragePath: copy('mediaStoragePath'),
  rightsAttestationVersion: copy('rightsAttestationVersion'),
  rightsAttestedAtMillis: { integerValue: String(now) },
  radiusMeters: { integerValue: '0' },
  radius: { integerValue: '0' },
  organicRadiusMeters: { integerValue: '0' },
  viewCount: { integerValue: '0' },
  likeCount: { integerValue: '0' },
  downvoteCount: { integerValue: '0' },
  commentCount: { integerValue: '0' },
  userID: { stringValue: OWNER_UID },
  username: { stringValue: OWNER_USERNAME },
  syntheticBeta: { booleanValue: true },
  syntheticSource: { stringValue: 'radius-growth-test' },
  updatedAt: { timestampValue: new Date(now).toISOString() },
}
const created = await (await fetch(`${FS}/posts?documentId=${postId}`, {
  method: 'POST', headers, body: JSON.stringify({ fields }),
})).json()
if (!created.name) { console.error('create failed', created); process.exit(1) }
appendFileSync(new URL('./manifest.md', import.meta.url).pathname,
  `- ${new Date().toISOString()} created posts/${postId} (owner ${OWNER_UID}, radius 0, `
  + `syntheticSource: radius-growth-test, at ${LAT},${LNG}); engagement runs add `
  + `posts/${postId}/{engagements,engagementActors} docs + owner notifications.\n`)
// So sibling drivers can find the newest fixture without anyone pasting ids.
writeFileSync(new URL('./.last-fixture', import.meta.url).pathname, postId)
console.log(postId)
