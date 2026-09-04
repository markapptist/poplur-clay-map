// Phase 2: multi-actor linearity + write contention. All five cohort actors
// fire view+like+comment at ONE fresh radius-0 fixture — fifteen transactions
// landing concurrently on the same post doc. Growth must be exactly linear in
// actors (every first touch pays in full: 5 × 4000 m = 20 km) and the
// transaction must lose nothing under contention: the stored doc must equal
// the sum of every applied delta.
//   Run AFTER: node mint-cohort.mjs   and a FRESH   node make-fixture-post.mjs
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
const API_KEY = 'AIzaSyDbDM14RX9pIBk4NB-paCArt_7UZBt6OYM'
const PROJECT = 'poplur2025'
const CALLABLE = `https://us-central1-${PROJECT}.cloudfunctions.net/recordPostEngagement`
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`
const passwordForActor = email => {
  const [, n, entropy] = email.match(/^radius\.actor\.(\d+)-([a-z0-9]+)@/)
  return `Poplur!Radius-${n}-${entropy}-9z`
}
const POST = process.argv[2]
  ?? readFileSync(new URL('./.last-fixture', import.meta.url).pathname, 'utf8').trim()
const EMAILS = JSON.parse(readFileSync(new URL('./.cohort.json', import.meta.url).pathname, 'utf8'))
let failures = 0
const check = (n, ok, d = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `  — ${d}` : ''}`) }

const tokens = await Promise.all(EMAILS.map(async email => {
  const r = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: passwordForActor(email), returnSecureToken: true }),
  })).json()
  if (!r.idToken) throw new Error(`sign-in failed for ${email}: ${r.error?.message}`)
  return r.idToken
}))
console.log(`${tokens.length} actors signed in; firing 15 concurrent engagements at ${POST}\n`)

const EXPECT = { view: 1000, like: 1000, comment: 2000 }
const started = Date.now()
const results = await Promise.all(tokens.flatMap((token, actor) =>
  Object.keys(EXPECT).map(kind =>
    fetch(CALLABLE, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { postId: POST, eventId: `rg2-a${actor}-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, kind } }),
    }).then(r => r.json()).then(r => ({ actor: actor + 1, kind, ...(r.result ?? {}), error: r.error })),
  )))
const wallMs = Date.now() - started

for (const r of results) {
  if (r.error) { check(`actor ${r.actor} ${r.kind}`, false, JSON.stringify(r.error)); continue }
  check(`actor ${r.actor} ${r.kind} pays +${EXPECT[r.kind]}`,
    r.applied === true && r.radiusDeltaMeters === EXPECT[r.kind],
    `applied=${r.applied} Δ${r.radiusDeltaMeters}`)
}
const paidTotal = results.reduce((sum, r) => sum + (r.radiusDeltaMeters ?? 0), 0)
check('growth is linear in actors: 5 × 4000 m paid', paidTotal === 20_000, `paid ${paidTotal} m in ${wallMs} ms`)

const token = execFileSync('gcloud', ['auth', 'application-default', 'print-access-token'], { encoding: 'utf8' }).trim()
const doc = await (await fetch(`${FS}/posts/${POST}`, { headers: { Authorization: `Bearer ${token}` } })).json()
const n = k => Number(Object.values(doc.fields?.[k] ?? {})[0])
check('no write lost under contention: stored doc equals the paid sum',
  n('radiusMeters') === 20_000 && n('organicRadiusMeters') === 20_000
  && n('viewCount') === 5 && n('likeCount') === 5 && n('commentCount') === 5 && n('downvoteCount') === 0,
  `radius=${n('radiusMeters')} v=${n('viewCount')} l=${n('likeCount')} c=${n('commentCount')}`)
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures ? 1 : 0)
