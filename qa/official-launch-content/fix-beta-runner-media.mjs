// The synthetic Beta Runner cohort posts carry solid-green placeholder clips,
// which read as broken content on device. Re-point every Beta Runner post at
// the APPROVED demo creatives (the same licensed set the feed and the
// official posts use), matched to the post's channel — never generated or
// unapproved media, per the standing lab-media rule.
import { execFileSync } from 'node:child_process'
const FS = 'https://firestore.googleapis.com/v1/projects/poplur2025/databases/(default)/documents'
const PACK = 'https://storage.googleapis.com/poplur2025-assets/asset-packs/feed'
const BY_CHANNEL = {
  food: 'ad-food.mp4', sports: 'ad-sports.mp4', shopping: 'ad-shopping.mp4',
  music: 'ad-music.mp4', cartoon: 'ad-cartoon.mp4', kids: 'ad-kids.mp4',
  comedy: 'ad-comedy.mp4', spanish: 'ad-spanish-1.mp4', french: 'ad-french.mp4',
}
const ROTATION = Object.values(BY_CHANNEL)
const token = execFileSync('gcloud', ['auth', 'application-default', 'print-access-token'], { encoding: 'utf8' }).trim()
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const rows = await (await fetch(`${FS}:runQuery`, {
  method: 'POST', headers,
  body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'posts' }], limit: 300 } }),
})).json()
let patched = 0
let index = 0
for (const row of rows) {
  const doc = row.document
  if (!doc) continue
  const f = doc.fields ?? {}
  const username = f.username?.stringValue ?? ''
  if (!username.startsWith('Beta Runner')) continue
  const mediaURL = f.mediaURL?.stringValue ?? f.playbackURL?.stringValue ?? ''
  if (mediaURL.includes('/asset-packs/feed/')) continue // already approved media
  const channel = f.channelId?.stringValue ?? ''
  const file = BY_CHANNEL[channel] ?? ROTATION[index++ % ROTATION.length]
  const postId = doc.name.split('/documents/posts/')[1]
  const mask = ['mediaURL', 'playbackURL', 'posterURL', 'mediaType']
    .map(k => `updateMask.fieldPaths=${k}`).join('&')
  const r = await fetch(`${FS}/posts/${postId}?${mask}`, {
    method: 'PATCH', headers,
    body: JSON.stringify({ fields: {
      mediaURL: { stringValue: `${PACK}/${file}` },
      playbackURL: { stringValue: `${PACK}/${file}` },
      posterURL: { stringValue: `${PACK}/posters/${file.replace(/\.mp4$/, '.jpg')}` },
      mediaType: { stringValue: 'video' },
    } }),
  })
  if (!r.ok) { console.error(`FAILED ${postId}: ${r.status}`); continue }
  patched += 1
  console.log(`${postId} (${channel || 'no channel'}) -> ${file}`)
}
console.log(`\n${patched} Beta Runner posts re-pointed at approved creatives.`)
console.log('NOTE: the live cohort runner still posts green clips for NEW posts —')
console.log('its media source needs the same approved-pack switch (runner config,')
console.log('PoplurLandingPage-HTML/PoplurApp/scripts), or rerun this after each soak.')
