// Phase 3: grow a post's radius across the viewer-distance threshold and let
// the map probes catch the ghost→real flip. Two steps so the mid-state (grown
// but still short of the threshold) can be probed between them:
//   node phase3-flip.mjs <postId> grow    → view+like+comment = 4000 m (< 4200)
//   node phase3-flip.mjs <postId> cross   → one repeat view    = 4500 m (≥ 4200)
// The fixture sits 4.2 km north of the deterministic browser viewer, so the
// shared reach predicate (distance <= radiusMeters) flips at 4200 m.
const API_KEY = 'AIzaSyDbDM14RX9pIBk4NB-paCArt_7UZBt6OYM'
const PROJECT = 'poplur2025'
const CALLABLE = `https://us-central1-${PROJECT}.cloudfunctions.net/recordPostEngagement`
const ACTOR = 'shared.first.user.mtit1f4e-bb8227c65b@synthetic.poplur.test'
const passwordFor = email => {
  const [, stamp, entropy] = email.match(/\.([a-z0-9]+)-([a-f0-9]+)@/)
  return `Poplur!First-${stamp}-${entropy}-9z`
}
// `node phase3-flip.mjs grow|cross` uses the id saved by make-fixture-post;
// an explicit post id may still be passed ahead of the step.
import { readFileSync } from 'node:fs'
const args = process.argv.slice(2)
const STEP = args.find(a => a === 'grow' || a === 'cross')
let POST = args.find(a => a !== STEP)
if (!POST) {
  try { POST = readFileSync(new URL('./.last-fixture', import.meta.url).pathname, 'utf8').trim() } catch { /* fall through */ }
}
if (!POST || !STEP) {
  console.error('usage: node phase3-flip.mjs [postId] grow|cross  (postId defaults to .last-fixture)'); process.exit(2)
}
console.log(`post: ${POST}`)
let failures = 0
const check = (n, ok, d = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `  — ${d}` : ''}`) }
const r0 = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: ACTOR, password: passwordFor(ACTOR), returnSecureToken: true }),
})).json()
if (!r0.idToken) { console.error('sign-in failed', r0.error?.message); process.exit(1) }
const engage = async kind => {
  const r = await (await fetch(CALLABLE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${r0.idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { postId: POST, eventId: `rg3-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, kind } }),
  })).json()
  if (r.error) { console.error(`callable error on ${kind}:`, r.error); process.exit(1) }
  return r.result
}
const fmt = r => `applied=${r.applied} Δ${r.radiusDeltaMeters} radius=${r.counters.radiusMeters}`
if (STEP === 'grow') {
  let r = await engage('view')
  check('view +1000', r.applied && r.counters.radiusMeters === 1000, fmt(r))
  r = await engage('like')
  check('like +1000', r.applied && r.counters.radiusMeters === 2000, fmt(r))
  r = await engage('comment')
  check('comment +2000 → 4000, still short of the 4200 threshold', r.applied && r.counters.radiusMeters === 4000, fmt(r))
} else {
  const r = await engage('view')
  check('repeat view +500 → 4500, past the 4200 threshold', r.applied && r.radiusDeltaMeters === 500 && r.counters.radiusMeters === 4500, fmt(r))
}
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures ? 1 : 0)
