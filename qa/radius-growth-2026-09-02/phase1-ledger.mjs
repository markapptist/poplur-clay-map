// Phase 1: single-actor radius ledger regression against the PRODUCTION
// recordPostEngagement callable (us-central1). Walks one stranger actor and
// the owner through every engagement kind on a fresh radius-0 fixture post and
// asserts the exact ledger: view +1000 (first) / 0 (<30s) / +500 (>=30s),
// like +1000 once, comment +2000 first only (repeats count, pay 0),
// dislike -1000 once, owner +0 on everything, duplicate eventId replay +0.
// Usage: node phase1-ledger.mjs <postId>
import { execFileSync } from 'node:child_process'
const API_KEY = 'AIzaSyDbDM14RX9pIBk4NB-paCArt_7UZBt6OYM'
const PROJECT = 'poplur2025'
const CALLABLE = `https://us-central1-${PROJECT}.cloudfunctions.net/recordPostEngagement`
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`
// Both are synthetic workbench accounts with derivable passwords (see the
// shared-onboarding-journey notes). ACTOR owns the Paris fixture, not this
// post; OWNER owns this post.
const ACTOR = 'shared.first.user.mtit1f4e-bb8227c65b@synthetic.poplur.test'
const OWNER = 'shared.first.user.mtive6bz-a9033d3878@synthetic.poplur.test'
const passwordFor = email => {
  const [, stamp, entropy] = email.match(/\.([a-z0-9]+)-([a-f0-9]+)@/)
  return `Poplur!First-${stamp}-${entropy}-9z`
}
const POST = process.argv[2]
if (!POST) { console.error('usage: node phase1-ledger.mjs <postId>'); process.exit(2) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (n, ok, d = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `  — ${d}` : ''}`) }
const signIn = async email => {
  const r = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: passwordFor(email), returnSecureToken: true }),
  })).json()
  if (!r.idToken) { console.error('sign-in failed for', email, r.error?.message); process.exit(1) }
  return r.idToken
}
const eventIds = new Set()
const engage = async (token, kind, eventId = `rg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`) => {
  eventIds.add(eventId)
  const r = await (await fetch(CALLABLE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { postId: POST, eventId, kind } }),
  })).json()
  if (r.error) { console.error(`callable error on ${kind}:`, r.error); process.exit(1) }
  return { ...r.result, eventId }
}
const fmt = r => `applied=${r.applied} Δ${r.radiusDeltaMeters} radius=${r.counters.radiusMeters} dup=${r.duplicate}`

const actor = await signIn(ACTOR)
const owner = await signIn(OWNER)

let r = await engage(actor, 'view')
const firstViewEventId = r.eventId
check('first view pays +1000', r.applied && r.radiusDeltaMeters === 1000 && r.counters.radiusMeters === 1000, fmt(r))
r = await engage(actor, 'view')
check('a view inside 30s pays nothing and does not count', !r.applied && r.radiusDeltaMeters === 0 && r.counters.viewCount === 1, fmt(r))
r = await engage(actor, 'view', firstViewEventId)
check('replaying an eventId is a duplicate, +0', r.duplicate === true && r.counters.radiusMeters === 1000, fmt(r))
r = await engage(actor, 'like')
check('like pays +1000', r.applied && r.radiusDeltaMeters === 1000 && r.counters.radiusMeters === 2000, fmt(r))
r = await engage(actor, 'like')
check('a second like from the same account pays +0', !r.applied && r.counters.likeCount === 1 && r.counters.radiusMeters === 2000, fmt(r))
r = await engage(actor, 'comment')
check('first comment pays +2000', r.applied && r.radiusDeltaMeters === 2000 && r.counters.radiusMeters === 4000, fmt(r))
r = await engage(actor, 'comment')
check('a repeat comment still counts but pays +0',
  r.applied && r.radiusDeltaMeters === 0 && r.counters.commentCount === 2 && r.counters.radiusMeters === 4000, fmt(r))
r = await engage(actor, 'dislike')
check('dislike pays -1000', r.applied && r.radiusDeltaMeters === -1000 && r.counters.radiusMeters === 3000, fmt(r))
r = await engage(actor, 'dislike')
check('a second dislike pays +0', !r.applied && r.counters.downvoteCount === 1 && r.counters.radiusMeters === 3000, fmt(r))
r = await engage(owner, 'view')
check('the owner viewing their own post records NOTHING', !r.applied && r.counters.viewCount === 1 && r.counters.radiusMeters === 3000, fmt(r))
r = await engage(owner, 'like')
check('the owner liking their own post records NOTHING', !r.applied && r.counters.likeCount === 1 && r.counters.radiusMeters === 3000, fmt(r))
console.log('… waiting 31s for the repeat-view gate …')
await sleep(31_000)
r = await engage(actor, 'view')
check('a repeat view after 30s pays +500', r.applied && r.radiusDeltaMeters === 500 && r.counters.radiusMeters === 3500, fmt(r))

// Independent read-back: the stored doc, not the callable's echo.
const token = execFileSync('gcloud', ['auth', 'application-default', 'print-access-token'], { encoding: 'utf8' }).trim()
const doc = await (await fetch(`${FS}/posts/${POST}`, { headers: { Authorization: `Bearer ${token}` } })).json()
const n = k => Number(Object.values(doc.fields?.[k] ?? {})[0])
check('stored doc agrees: radius 3500, organic 3500, views 2, likes 1, comments 2, dislikes 1',
  n('radiusMeters') === 3500 && n('organicRadiusMeters') === 3500 && n('viewCount') === 2
  && n('likeCount') === 1 && n('commentCount') === 2 && n('downvoteCount') === 1,
  `radius=${n('radiusMeters')} organic=${n('organicRadiusMeters')} v=${n('viewCount')} l=${n('likeCount')} c=${n('commentCount')} d=${n('downvoteCount')}`)
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures ? 1 : 0)
