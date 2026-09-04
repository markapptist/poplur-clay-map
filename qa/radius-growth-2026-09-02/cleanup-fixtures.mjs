// Deletes the radius-growth fixture posts and their engagement subcollections
// from production. The Paris trio and the original shared-journey post are NOT
// listed here and must never be. Cohort Auth accounts are permanent test
// infrastructure and are kept. Pass extra post ids as args if later runs
// added fixtures beyond these.
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
const FS = 'https://firestore.googleapis.com/v1/projects/poplur2025/databases/(default)/documents'
const FIXTURES = [
  'post-radius-growth-2026-09-02-4tycck',   // phase 1 ledger fixture (3.5 km)
  'post-radius-growth-2026-09-02-8vvq3e',   // orphan double-run fixture (0 m)
  'post-radius-growth-2026-09-02-33hfaf',   // phase 3/4 flip + drift fixture (34 km)
  'post-radius-growth-2026-09-03-l517v1',   // phase 2 multi-actor fixture (20 km)
  ...process.argv.slice(2),
]
const token = execFileSync('gcloud', ['auth', 'application-default', 'print-access-token'], { encoding: 'utf8' }).trim()
const headers = { Authorization: `Bearer ${token}` }
const del = async path => {
  const r = await fetch(`${FS}/${path}`, { method: 'DELETE', headers })
  if (!r.ok) console.error(`  delete FAILED ${path}: ${r.status}`)
  return r.ok
}
for (const postId of FIXTURES) {
  const head = await fetch(`${FS}/posts/${postId}`, { headers })
  if (head.status === 404) { console.log(`${postId}: already gone`); continue }
  let removed = 0
  for (const sub of ['engagements', 'engagementActors']) {
    let pageToken = ''
    do {
      const page = await (await fetch(
        `${FS}/posts/${postId}/${sub}?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`,
        { headers },
      )).json()
      for (const doc of page.documents ?? []) {
        if (await del(doc.name.split('/documents/')[1])) removed += 1
      }
      pageToken = page.nextPageToken ?? ''
    } while (pageToken)
  }
  const ok = await del(`posts/${postId}`)
  console.log(`${postId}: ${ok ? 'deleted' : 'FAILED'} (+${removed} engagement docs)`)
  if (ok) {
    appendFileSync(new URL('./manifest.md', import.meta.url).pathname,
      `- ${new Date().toISOString()} CLEANED posts/${postId} and ${removed} engagement docs.\n`)
  }
}
console.log('\nKept: Paris trio, the shared-journey post, and the 5 cohort accounts (permanent).')
