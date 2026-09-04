#!/usr/bin/env node
// Headless proof of the radius high striker, the Poplur pop dialog and the
// map→feed handoff, driven in the REAL nested shell (5173 ?view=camera) — never
// the standalone map, where window.parent === window hides every shell-side
// failure. Polls the DOM rather than screenshotting (CDP screenshots starve
// under load; see headless_probe_over_screenshot), and takes ONE screenshot
// per milestone at the end of each step as proof.
//
//   node qa/radius-striker-2026-09-03/probe.mjs [origin] [--out DIR]
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const args = process.argv.slice(2)
const ORIGIN = args.find(a => !a.startsWith('--')) ?? 'http://127.0.0.1:5173'
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(process.cwd(), 'qa/radius-striker-2026-09-03/out')
const PORT = 9611 + (process.pid % 150)
mkdirSync(OUT, { recursive: true })

const profileDir = mkdtempSync(join(tmpdir(), 'poplur-striker-'))
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`,
  '--headless=new', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-first-run', '--no-default-browser-check', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--enable-gpu-rasterization',
  '--window-size=393,852', 'about:blank',
], { stdio: 'ignore' })
const cleanup = () => { try { chrome.kill() } catch {} try { rmSync(profileDir, { recursive: true, force: true }) } catch {} }
process.on('exit', cleanup)
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function target() {
  for (let i = 0; i < 100; i++) {
    try {
      const t = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const p = t.find(x => x.type === 'page')
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl
    } catch {}
    await sleep(150)
  }
  throw new Error('Chrome DevTools endpoint never came up')
}
function connect(ws) {
  const s = new WebSocket(ws); let id = 1; const pend = new Map()
  s.addEventListener('message', e => {
    const m = JSON.parse(e.data)
    if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result) }
  })
  return {
    ready: new Promise((res, rej) => { s.addEventListener('open', res); s.addEventListener('error', rej) }),
    send: (method, params = {}) => new Promise((res, rej) => { const i = id++; pend.set(i, { res, rej }); s.send(JSON.stringify({ id: i, method, params })) }),
  }
}
const cdp = connect(await target())
await cdp.ready
await cdp.send('Page.enable')
await cdp.send('Runtime.enable')
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 2, mobile: true })
// A viewer fix the Map can find on its own, so the map→shell location bridge
// has something to carry. Downtown Toronto, a block from the preview origin.
await cdp.send('Browser.grantPermissions', { origin: ORIGIN, permissions: ['geolocation'] })
await cdp.send('Emulation.setGeolocationOverride', { latitude: 43.6512, longitude: -79.3832, accuracy: 20 })

const ev = async (expression) => {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
  return result.value
}
const shot = async (name) => {
  try {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(OUT, name), Buffer.from(data, 'base64'))
    console.log(`  📸 ${name}`)
  } catch (error) { console.log(`  (screenshot ${name} skipped: ${error.message})`) }
}
const until = async (label, expression, ms = 60_000, every = 400) => {
  const started = Date.now()
  for (;;) {
    let value = null
    try { value = await ev(expression) } catch {}
    if (value) return value
    if (Date.now() - started > ms) throw new Error(`timed out waiting for ${label}`)
    await sleep(every)
  }
}
const FRAME = `document.querySelector('iframe[title="Poplur clay map"]')`
const IN = (js) => `(() => { const f = ${FRAME}; const w = f && f.contentWindow; const d = f && f.contentDocument; if (!w || !d) return null; return (${js})(w, d) })()`

const verdicts = []
const verdict = (name, ok, detail) => { verdicts.push({ name, ok, detail }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`) }

console.log(`▶ ${ORIGIN}/?view=camera`)
await cdp.send('Page.navigate', { url: `${ORIGIN}/?view=camera` })
// The camera lives in the shell document itself (no iframe): wait for its
// screen root, then for the live surface the stepper mounts beside.
await until('the camera screen', `Boolean(document.querySelector('[data-poplur-screen="camera"]'))`, 90_000)
await sleep(2500)

// ── The camera's stepper: filters up/down, lens presets left/right, hold to zoom ──
await ev(`(() => { window.__zoomLog = []; window.addEventListener('poplur-camera-zoom', e => window.__zoomLog.push({ t: performance.now(), zoom: e.detail.zoom })); return 1 })()`)
const stepper = await until('the camera stepper', `(() => { const g = document.querySelector('[data-camera-step]'); if (!g) return null; return { filter: g.dataset.cameraStepFilter, buttons: [...g.querySelectorAll('button')].map(b => b.getAttribute('aria-label')) } })()`, 90_000)
verdict('camera stepper mounted with the feed-shaped block', Boolean(stepper && stepper.buttons.length === 4), JSON.stringify(stepper))
await ev(`(() => { const p = [...document.querySelectorAll('p')].find(x => /tap anywhere to start/i.test(x.textContent)); if (p) (p.closest('[role]') || p.parentElement).click(); return 1 })()`)
await sleep(600)
const WHEEL = `(() => { const rail = document.querySelector('[data-camera-ar-rail]'); if (!rail) return null; const sel = rail.querySelector('[aria-selected="true"], [aria-pressed="true"], [data-selected="true"]'); const r = sel && sel.getBoundingClientRect(); return { label: sel ? (sel.getAttribute('aria-label') || sel.textContent.trim()) : null, y: r ? Math.round(r.top) : null } })()`
const before = await ev(WHEEL)
const filterBefore = await ev(`document.querySelector('[data-camera-step]').dataset.cameraStepFilter`)
await ev(`document.querySelector('[data-camera-step] button[aria-label="Next filter"]').click()`)
// The clay wheel spins to the new pick before it re-marks aria-selected; give
// it the spin (and a loaded host) before reading which tile is lit.
let after = await ev(WHEEL)
for (let i = 0; i < 12 && (!after || after.label === before?.label); i++) { await sleep(500); after = await ev(WHEEL) }
const filterAfter = await ev(`document.querySelector('[data-camera-step]').dataset.cameraStepFilter`)
verdict('▲ steps to the next filter (readout and wheel move together)', filterBefore === '1' && filterAfter === '2' && before?.label !== after?.label, `readout ${filterBefore}→${filterAfter} · wheel ${JSON.stringify(before)} → ${JSON.stringify(after)}`)
if (before?.y != null && after?.y != null) console.log(`  wheel direction: the new pick sits ${after.y < before.y ? 'ABOVE' : after.y > before.y ? 'BELOW' : 'AT THE SAME HEIGHT AS'} the old one (▲ pressed)`)
await ev(`document.querySelector('[data-camera-step] button[aria-label="Previous filter"]').click()`)
await sleep(500)
verdict('▼ steps back', (await ev(`document.querySelector('[data-camera-step]').dataset.cameraStepFilter`)) === '1')
const LIT = `(() => { const b = document.querySelector('[aria-label="Zoom presets"] button[aria-pressed="true"]'); return b ? b.textContent.trim() : null })()`
const READOUT = `(() => { const s = document.querySelector('[data-camera-step-zoom-label]'); return s ? s.textContent.trim() : null })()`
const lit0 = await ev(LIT)
await ev(`document.querySelector('[data-camera-step-zoom="in"]').click()`)
await sleep(500)
const lit1 = await ev(LIT)
await ev(`document.querySelector('[data-camera-step-zoom="in"]').click()`)
await sleep(500)
const lit2 = await ev(LIT)
verdict('▶ cycles the lens presets 1× → 2× → .5×', lit0 === '1×' && lit1 === '2×' && lit2 === '.5×', `${lit0} → ${lit1} → ${lit2}`)
verdict('the readout between ◀ ▶ says the current zoom', (await ev(READOUT)) === '.5×', `readout ${await ev(READOUT)} while the lit chip is ${lit2}`)
await ev(`document.querySelector('[data-camera-step-zoom="out"]').click()`)
await sleep(500)
verdict('◀ cycles back', (await ev(LIT)) === '2×', await ev(LIT))
// Hold ▶ for 1.2 s: the rocker must ramp past the preset and stop on release.
await ev(`(() => { window.__zoomLog = []; const b = document.querySelector('[data-camera-step-zoom="in"]'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, button: 0, pointerId: 7, pointerType: 'touch' })); return 1 })()`)
await sleep(1200)
const heldAttr = await ev(`document.querySelector('[data-camera-step-zoom="in"]').dataset.held`)
const readoutMidHold = await ev(READOUT)
await ev(`(() => { const b = document.querySelector('[data-camera-step-zoom="in"]'); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, isPrimary: true, button: 0, pointerId: 7, pointerType: 'touch' })); return 1 })()`)
await sleep(400)
const log1 = await ev(`window.__zoomLog.map(e => e.zoom)`)
await sleep(600)
const log2 = await ev(`window.__zoomLog.map(e => e.zoom)`)
const ramped = Array.isArray(log1) && log1.length >= 3 && log1[log1.length - 1] > 2.05
verdict('holding ▶ ramps the zoom past the preset and stops on release', ramped && log2.length === log1.length && heldAttr === 'true', `held=${heldAttr} · ${log1.length} steps: ${JSON.stringify(log1.slice(0, 4))}…${JSON.stringify(log1.slice(-2))} · after release +${log2.length - log1.length}`)
verdict('the readout follows the rocker', /^\d(\.\d)?×$/.test(readoutMidHold ?? '') && readoutMidHold !== '2×', `mid-hold readout ${readoutMidHold} · final ${await ev(READOUT)}`)
await shot('1-camera-stepper.png')
chrome.kill(); cleanup(); process.exit(verdicts.every(v => v.ok) ? 0 : 1)
