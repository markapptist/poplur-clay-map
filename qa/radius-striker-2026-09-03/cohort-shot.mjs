#!/usr/bin/env node
// Cohort colour proof: opens the nested shell, dismisses the coach, jumps the
// camera to downtown Toronto and counts the mounted pins by owner (exit 0 when
// at least five conquer-cohort pins are seated). Derived from probe.mjs.
// Headless proof of the radius high striker, the Poplur pop dialog and the
// map→feed handoff, driven in the REAL nested shell (5173 ?view=map) — never
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
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--mute-audio',
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

console.log(`▶ ${ORIGIN}/?view=map`)
await cdp.send('Page.navigate', { url: `${ORIGIN}/?view=map` })
await until('the map frame', `Boolean(${FRAME})`, 90_000)
await until('the map to load', IN(`(w) => Boolean(w.__map && w.__map.loaded && w.__map.loaded())`), 120_000, 800)
await until('the zoom rail', IN(`(w, d) => Boolean(d.querySelector('[data-zoom-thumb]'))`), 60_000)
await sleep(4000)

// ── Cohort colour proof: downtown Toronto at neighbourhood scale ──
await ev(`(() => { const p = [...document.querySelectorAll('p')].find(x => /tap anywhere to start/i.test(x.textContent)); if (p) (p.closest('[role]') || p.parentElement).click(); return 1 })()`)
await sleep(800)
await ev(IN(`(w) => { w.__map.jumpTo({ center: [-79.3811, 43.6487], zoom: 12.6, pitch: 0, bearing: 0 }); return 1 }`))
await sleep(9000)
const pins = await ev(IN(`(w, d) => { const roots = [...d.querySelectorAll('[data-map-point-kind="pin"][data-domination-owner]')]; return { mounted: roots.length, owners: [...new Set(roots.map(r => r.dataset.dominationOwner))], cohort: roots.filter(r => (r.dataset.mapPointId || '').includes('radius-lab-cohort')).map(r => ({ id: r.dataset.mapPointId.replace('pin:firestore:post-radius-lab-cohort-2026-09-03-', ''), label: r.querySelector('button')?.getAttribute('aria-label') })) } }`))
console.log('PINS', JSON.stringify(pins, null, 1))
await shot('4-cohort-downtown.png')
chrome.kill(); cleanup(); process.exit(pins && pins.cohort && pins.cohort.length >= 5 ? 0 : 2)
