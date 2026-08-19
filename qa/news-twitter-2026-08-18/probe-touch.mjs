// The device-shaped test: a TOUCH pull (not pointer-only) on an emulated
// mobile device, against the production build. This is the closest a headless
// browser gets to the phone, where the native scroller competes for the drag.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const BASE = process.argv[2] ?? 'http://127.0.0.1:8131'
const SCREEN = process.argv[3] ?? 'feed-news'
const PORT = 9561
const dir = mkdtempSync(join(tmpdir(), 'tch-'))
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
  '--window-size=430,932', '--mute-audio', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
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
const waitFor = async (e, ms, s = 350) => { const u = Date.now() + ms; while (Date.now() < u) { if (await ev(`!!(${e})`)) return true; await sleep(s) } return false }

// Emulate a real touch device: the scroller then genuinely competes for the drag.
await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 3, mobile: true })
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
await send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' })

await send('Page.navigate', { url: `${BASE}/?view=holdmenu&holdScreen=${SCREEN}` })
check('screen mounts', await waitFor(`document.querySelector('[data-pull-panel]')`, 30_000))
await sleep(3000)
await ev(`window.__refreshed = 0; window.addEventListener('poplur-pull-refreshed', () => window.__refreshed++)`)
const before = await ev(`[...document.querySelectorAll('[class*="timeline"] article p')].slice(0,3).map(p=>p.textContent).join('|')`)

// A REAL touch drag through CDP — dispatchTouchEvent, not a synthetic DOM event.
const host = await ev(`(() => { const r = document.querySelector('[data-pull-panel]').parentElement.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + 90) } })()`)
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: host.x, y: host.y }] })
for (let i = 1; i <= 14; i++) {
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: host.x, y: host.y + i * 20 }] })
  await sleep(18)
}
const mid = await ev(`(() => {
  const panel = document.querySelector('[data-pull-panel]')
  const host = panel.parentElement
  const runner = [...panel.querySelectorAll('img')].find(i => /poplurgatchi/.test(i.src))
  return { band: Math.round(panel.getBoundingClientRect().bottom - host.getBoundingClientRect().top),
           pet: runner ? getComputedStyle(runner).display : 'none' }
})()`)
check('a TOUCH pull opens the curtain', mid.band > 40, `band ${mid.band}px`)
check('the pet is out during the touch pull', mid.pet === 'block', `display ${mid.pet}`)
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
await sleep(2800)
const after = await ev(`[...document.querySelectorAll('[class*="timeline"] article p')].slice(0,3).map(p=>p.textContent).join('|')`)
if (SCREEN === 'feed-news') {
  check('the touch pull actually reprinted the paper', before !== after,
    `${(before||'').slice(0,30)}… → ${(after||'').slice(0,30)}…`)
  check('and announced the new posts', await ev(`!!document.querySelector('[class*="freshBanner"]')`) || after !== before)
}
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures ? 1 : 0)
