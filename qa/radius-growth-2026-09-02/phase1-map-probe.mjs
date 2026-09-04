// Phase 1 map verification: the grown fixture post renders as a REAL
// (non-ghost) pin in the nested shell, since it sits on the deterministic
// browser viewer origin. Headless — the pane-visibility trap does not apply.
// Usage: node phase1-map-probe.mjs <postId> [expectGhost]
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const BASE = 'http://127.0.0.1:5173'
const args = process.argv.slice(2)
const AT = args.find(a => a.startsWith('at='))?.slice(3) // "lat,lng"
const CONTROL = args.find(a => a.startsWith('control='))?.slice(8) // known in-reach postId
const MODE = args.find(a => a === 'ghost' || a === 'absent') ?? 'real'
const POST = args.find(a => a !== MODE && !a.includes('='))
if (!POST) { console.error('usage: node phase1-map-probe.mjs <postId> [ghost|absent] [at=lat,lng] [control=postId]'); process.exit(2) }
const PORT = 9583
const dir = mkdtempSync(join(tmpdir(), 'rg-'))
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
  '--window-size=430,932', '--force-device-scale-factor=2', '--mute-audio',
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
const send = (m, p = {}) => new Promise(res => { const i = ++id; pending.set(i, res); setTimeout(() => { pending.delete(i); res({}) }, 40000); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.result?.value
const waitFor = async (e, ms, s = 500) => { const u = Date.now() + ms; while (Date.now() < u) { if (await ev(`!!(${e})`)) return true; await sleep(s) } return false }

await send('Page.navigate', { url: `${BASE}/?view=map` })
// Markers exist only while their coordinate is inside the camera view
// (syncPins culls off-screen pins from the DOM entirely), so a fixture away
// from the viewer origin must be looked at before it can be asserted on.
// `at=lat,lng` jumps the map camera there once the map reports loaded.
if (AT) {
  const [lat, lng] = AT.split(',').map(Number)
  const MAP = `[...document.querySelectorAll('iframe')].map(f => { try { return f.contentWindow } catch { return null } }).find(w => w?.__poplurMap)?.__poplurMap`
  check('the map handle loads for the camera jump', await waitFor(`(${MAP})?.loaded?.()`, 90_000))
  await ev(`(${MAP}).jumpTo({ center: [${lng}, ${lat}], zoom: 12 })`)
  await sleep(4000) // let settle-time pin sync mount the markers
}
// The shell mounts ClayMap in a same-origin iframe; the pin markers live in
// THAT document, so every query walks the top document plus all frames.
const markerFor = postId => `(() => {
  const docs = [document, ...[...document.querySelectorAll('iframe')].map(f => { try { return f.contentDocument } catch { return null } })]
  for (const doc of docs) {
    const hit = doc?.querySelector('[data-map-point-id="pin:firestore:${postId}"], [data-map-point-id="pin:${postId}"]')
    if (hit) return hit
  }
  return null
})()`
const MARKER = markerFor(POST)
// A control pin known to be in reach separates "correctly absent" from "the
// pin pipeline never mounted" — required for absent mode to mean anything.
if (CONTROL) {
  check('the in-reach control pin mounts (pin pipeline alive)', await waitFor(markerFor(CONTROL), 90_000))
}
if (MODE === 'absent') {
  await sleep(6000) // give the target every chance to mount beside the control
  check('the out-of-reach pin is NOT on the board (dropped since a79fc90, 2 Sep)',
    !(await ev(`!!(${MARKER})`)))
} else {
  check('the fixture pin mounts on the shell map', await waitFor(MARKER, CONTROL ? 30_000 : 90_000))
  const pin = await ev(`(() => {
    const root = ${MARKER}
    if (!root) return null
    return {
      ghost: root.dataset.mapPointGhost === 'true',
      mine: root.dataset.mapPointMine,
      label: root.querySelector('button')?.getAttribute('aria-label') ?? '',
    }
  })()`)
  if (MODE === 'ghost') {
    check('it renders GHOSTED (dormant render path)', pin?.ghost === true, JSON.stringify(pin))
  } else {
    check('it renders as a REAL pin (viewer inside its radius)', pin?.ghost === false, JSON.stringify(pin))
  }
  check('its label carries the earned radius', /km/.test(pin?.label ?? ''), pin?.label)
}
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures ? 1 : 0)
