// Phase 4: measure the deliberately-open repeat-view drift. One signed-in
// actor sends a view every 31s against the sacrificial fixture; the policy
// pays +500 for every view >=30s after the last, with no cap, no diminishing
// returns and no decay — this soak turns that claim into numbers for the
// product call on capping it.
//   node phase4-drift.mjs [minutes] [postId]   (default 30 min, .last-fixture)
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
const API_KEY = 'AIzaSyDbDM14RX9pIBk4NB-paCArt_7UZBt6OYM'
const PROJECT = 'poplur2025'
const CALLABLE = `https://us-central1-${PROJECT}.cloudfunctions.net/recordPostEngagement`
const ACTOR = 'shared.first.user.mtit1f4e-bb8227c65b@synthetic.poplur.test'
const passwordFor = email => {
  const [, stamp, entropy] = email.match(/\.([a-z0-9]+)-([a-f0-9]+)@/)
  return `Poplur!First-${stamp}-${entropy}-9z`
}
const args = process.argv.slice(2)
const MINUTES = Number(args.find(a => /^\d+$/.test(a)) ?? 30)
let POST = args.find(a => a.startsWith('post-'))
if (!POST) {
  try { POST = readFileSync(new URL('./.last-fixture', import.meta.url).pathname, 'utf8').trim() } catch { /* fall through */ }
}
if (!POST || !MINUTES) { console.error('usage: node phase4-drift.mjs [minutes] [postId]'); process.exit(2) }
const TICK_MS = 31_000
const sleep = ms => new Promise(r => setTimeout(r, ms))

const signIn = async () => {
  const r = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ACTOR, password: passwordFor(ACTOR), returnSecureToken: true }),
  })).json()
  if (!r.idToken) throw new Error(`sign-in failed: ${r.error?.message}`)
  return r.idToken
}
let token = await signIn()
const view = async () => {
  const r = await (await fetch(CALLABLE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { postId: POST, eventId: `rg4-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, kind: 'view' } }),
  })).json()
  if (r.error) throw new Error(`${r.error.status ?? ''} ${r.error.message ?? JSON.stringify(r.error)}`)
  return r.result
}

const started = Date.now()
const deadline = started + MINUTES * 60_000
const csvPath = new URL(`./phase4-drift-${new Date(started).toISOString().replace(/[:.]/g, '-')}.csv`, import.meta.url).pathname
writeFileSync(csvPath, 'tick,elapsed_s,applied,delta_m,radius_m,error\n')
console.log(`post ${POST} — one view every ${TICK_MS / 1000}s for ${MINUTES} min\n`)
let tick = 0
let paid = 0
let refused = 0
let errors = 0
let firstRadius = null
let lastRadius = null
while (Date.now() < deadline) {
  const tickStart = Date.now()
  tick += 1
  let row
  try {
    const r = await view()
    if (r.applied) paid += 1; else refused += 1
    firstRadius ??= r.counters.radiusMeters - (r.applied ? r.radiusDeltaMeters : 0)
    lastRadius = r.counters.radiusMeters
    row = `${tick},${Math.round((tickStart - started) / 1000)},${r.applied},${r.radiusDeltaMeters},${r.counters.radiusMeters},`
    if (tick % 5 === 0 || tick === 1) {
      console.log(`tick ${String(tick).padStart(3)}  +${Math.round((tickStart - started) / 60000)}m  radius ${r.counters.radiusMeters}  (paid ${paid} / refused ${refused} / errors ${errors})`)
    }
  } catch (error) {
    errors += 1
    row = `${tick},${Math.round((tickStart - started) / 1000)},,,,"${String(error.message).replace(/"/g, "'")}"`
    console.log(`tick ${String(tick).padStart(3)}  ERROR ${error.message}`)
    // An expired token is the one recoverable auth failure a long soak meets.
    if (/UNAUTHENTICATED|401|expired/i.test(String(error.message))) {
      try { token = await signIn() } catch { /* next tick retries */ }
    }
  }
  appendFileSync(csvPath, row + '\n')
  const wait = tickStart + TICK_MS - Date.now()
  if (Date.now() + Math.max(0, wait) >= deadline) break
  if (wait > 0) await sleep(wait)
}

const minutes = (Date.now() - started) / 60_000
const driftMeters = (lastRadius ?? 0) - (firstRadius ?? 0)
const perMin = driftMeters / minutes
const summary = [
  `ticks ${tick} (paid ${paid}, refused ${refused}, errors ${errors})`,
  `radius ${firstRadius} → ${lastRadius} m  (+${driftMeters} m in ${minutes.toFixed(1)} min)`,
  `measured drift: ${Math.round(perMin)} m/min → ${(perMin * 60 / 1000).toFixed(1)} km/h → ${(perMin * 1440 / 1000).toFixed(0)} km/day from ONE account`,
  `world radius (40,075 km) in ${(40_075_000 / perMin / 1440).toFixed(1)} days at this rate`,
]
console.log('\n' + summary.join('\n'))
console.log(`csv: ${csvPath}`)
appendFileSync(new URL('./manifest.md', import.meta.url).pathname,
  `- ${new Date().toISOString()} phase4 drift soak on posts/${POST}: ${summary[0]}; ${summary[1]}.\n`)
const clean = errors === 0 && refused === 0 && paid === tick
console.log(clean ? '\nALL TICKS PAID — drift confirmed uncapped' : '\n(see refused/error ticks above)')
