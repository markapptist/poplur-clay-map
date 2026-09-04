// Phase 5: does the OWNER's displayed account total track server-side radius
// growth? MapApp subscribes to every post `where userID == ownUid`, sums
// radiusKm and publishes it (accountRadiusPosts.ts → accountRadius.ts), so the
// probe signs in as the owner inside the map iframe (via the app's own
// webSignIn), then compares the published total against an independent REST
// sum — twice, ~95s apart, so a concurrently running phase-4 drift soak shows
// the total moving live with a stranger's engagement.
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const BASE = 'http://127.0.0.1:5173'
const OWNER_EMAIL = 'shared.first.user.mtive6bz-a9033d3878@synthetic.poplur.test'
const OWNER_UID = 'n1BkpZPv4HcBKLAG7FXQTzYp7sF2'
const OWNER_PASSWORD = 'Poplur!First-mtive6bz-a9033d3878-9z'
const PORT = 9588
const dir = mkdtempSync(join(tmpdir(), 'p5-'))
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
  '--window-size=430,932', '--mute-audio',
], { stdio: 'ignore' })
process.on('exit', () => { try { chrome.kill() } catch {}; try { rmSync(dir, { recursive: true, force: true }) } catch {} })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (n, ok, d = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `  — ${d}` : ''}`) }
let t
for (let i = 0; i < 60 && !t; i++) { try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(x => x.type === 'page') } catch {}; if (!t) await sleep(500) }
const ws = new WebSocket(t.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
await new Promise(r => ws.addEventListener('open', r))
const send = (m, p = {}) => new Promise(res => { const i = ++id; pending.set(i, res); setTimeout(() => { pending.delete(i); res({}) }, 60000); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.result?.value
const waitFor = async (e, ms, s = 500) => { const u = Date.now() + ms; while (Date.now() < u) { if (await ev(`!!(${e})`)) return true; await sleep(s) } return false }

// Independent server truth: sum radiusMeters over the owner's posts via REST.
const restSumKm = () => {
  const token = execFileSync('gcloud', ['auth', 'application-default', 'print-access-token'], { encoding: 'utf8' }).trim()
  return fetch('https://firestore.googleapis.com/v1/projects/poplur2025/databases/(default)/documents:runQuery', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: 'posts' }],
      where: { fieldFilter: { field: { fieldPath: 'userID' }, op: 'EQUAL', value: { stringValue: OWNER_UID } } },
      limit: 300,
    } }),
  }).then(r => r.json()).then(rows => rows.reduce((sum, row) => {
    const f = row.document?.fields
    if (!f) return sum
    const raw = f.radiusMeters ?? f.radius ?? f.organicRadiusMeters
    return sum + (Number(Object.values(raw ?? {})[0]) || 0)
  }, 0) / 1000)
}

await send('Page.navigate', { url: `${BASE}/?view=map` })
const MAPW = `[...document.querySelectorAll('iframe')].map(f => { try { return f.contentWindow } catch { return null } }).find(w => w?.__poplurMap)`
check('the map document mounts', await waitFor(`(${MAPW})`, 90_000))
const uid = await ev(`(${MAPW}).eval(\`import('/src/webFirebase.ts').then(m => m.webSignIn('${OWNER_EMAIL}', '${OWNER_PASSWORD}')).then(u => u.uid)\`)`)
check("the owner signs in through the app's own auth", uid === OWNER_UID, String(uid))
const TOTAL = `Number((${MAPW}).localStorage.getItem('poplur.totalRadiusKm'))`
check('the authoritative account total publishes after sign-in', await waitFor(`${TOTAL} > 0`, 60_000))

const uiA = await ev(TOTAL)
const serverA = await restSumKm()
check("published total matches the server sum of the owner's posts (±1 km)",
  Math.abs(uiA - serverA) <= 1, `ui=${uiA.toFixed(1)} km, server=${serverA.toFixed(1)} km`)

console.log('… 95s for concurrent engagement (phase-4 drift) to move the server total …')
await sleep(95_000)
const uiB = await ev(TOTAL)
const serverB = await restSumKm()
check('published total still matches the server sum (±1 km)',
  Math.abs(uiB - serverB) <= 1, `ui=${uiB.toFixed(1)} km, server=${serverB.toFixed(1)} km`)
if (serverB - serverA >= 0.5) {
  check("the owner's total moved LIVE with a stranger's engagement",
    uiB - uiA >= 0.5, `ui ${uiA.toFixed(1)} → ${uiB.toFixed(1)} km while server ${serverA.toFixed(1)} → ${serverB.toFixed(1)} km`)
} else {
  console.log(`INFO  server total flat over the window (${serverA.toFixed(1)} → ${serverB.toFixed(1)} km) — run during the phase-4 soak for the live-movement check`)
}
const card = await ev(`document.body.innerText.match(/RADIUS[\\s\\S]{0,40}/)?.[0]?.replace(/\\s+/g, ' ')`)
console.log(`shell RADIUS card: ${card}`)
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures ? 1 : 0)
