// First-open coaching + the demand-scheduled cube spin.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const BASE = process.argv[2] ?? 'http://127.0.0.1:5173'
const OUT = process.argv[3]
const PORT = 9581
const dir = mkdtempSync(join(tmpdir(), 'co-'))
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
  '--window-size=430,932', '--force-device-scale-factor=2', '--mute-audio',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
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

// ── MAP: the split, the arrows, the words ──────────────────────────────────
await send('Page.navigate', { url: `${BASE}/?view=map` })
check('map coach appears on first open', await waitFor(`document.querySelector('[data-coach]')`, 40_000))
const map = await ev(`(() => {
  const c = document.querySelector('[data-coach]')
  if (!c) return null
  return {
    id: c.dataset.coach,
    split: !!c.querySelector('[class*="split"]'),
    seam: !!c.querySelector('[class*="seam"]'),
    arrows: c.querySelectorAll('[class*="pinArrowLeft"], [class*="pinArrowRight"]').length,
    ring: !!c.querySelector('[class*="pinRing"]'),
    text: c.innerText.replace(/\\s+/g, ' ').slice(0, 160),
    passesTaps: getComputedStyle(c).pointerEvents,
  }
})()`)
check('it splits the screen in half', map?.split && map?.seam, `split=${map?.split} seam=${map?.seam}`)
check('blue arrows flank the pin', (map?.arrows ?? 0) === 2 && map?.ring, `${map?.arrows} arrows, ring=${map?.ring}`)
check('it teaches left/right/hold',
  /LEFT/i.test(map?.text ?? '') && /RIGHT/i.test(map?.text ?? '') && /hold/i.test(map?.text ?? ''), map?.text)
check('the overlay never eats a tap', map?.passesTaps === 'none', String(map?.passesTaps))
if (OUT) { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r?.result?.data) writeFileSync(join(OUT, 'coach-map.png'), Buffer.from(r.result.data, 'base64')) }

// ── dismissal: a touch removes it, and it does not come back ───────────────
await ev(`window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`)
check('a touch dismisses it', await waitFor(`!document.querySelector('[data-coach]')`, 5000))
await send('Page.navigate', { url: `${BASE}/?view=map` })
await sleep(6000)
check('it does NOT teach the same screen twice', !(await ev(`!!document.querySelector('[data-coach]')`)))

// ── another screen still gets its own lesson ───────────────────────────────
await send('Page.navigate', { url: `${BASE}/?view=feed` })
check('the feed teaches itself too', await waitFor(`document.querySelector('[data-coach="tab-feed"]')`, 40_000))

// ── the cube spins on demand, then parks (Stage 0 demand scheduling) ───────
// Rewritten 2 Sep: the 18 Aug "still rotating after the old 8s window" check
// asserted an always-on idle spin that no longer exists. Owners now arm
// bounded turn windows (model arrival, touches, device motion — armGlobeSpin
// / cubeMotionThermalPolicy) and the render loop parks between them, saying
// why in window.__poplurGlobeSpin — read that contract, not the DEV-only
// __poplurCubeModel, which goes stale when the ambient showcase swaps models.
// Those swaps re-arm 8s arrival turns, so "parked" is observed by polling,
// never assumed after a fixed delay — and a tap only arms the spin while the
// globe (not a swapped-in showcase object) is the loaded navigator model.
await send('Page.navigate', { url: `${BASE}/?view=map` })
await waitFor(`window.__poplurGlobeSpin`, 40_000)
const GLOBE_UP = `/(?:globe|earth)/i.test(document.querySelector('[data-cube-renderer]')?.dataset.cubeModel ?? '')`
const PARKED = `window.__poplurGlobeSpin?.spinning === false && ${GLOBE_UP}`
check('the untouched cube parks between its bounded turn windows',
  await waitFor(PARKED, 40_000, 500),
  JSON.stringify(await ev(`window.__poplurGlobeSpin ?? null`)))
// Guard + tap in ONE evaluate so an ambient model swap cannot slip between
// "verified parked with the globe up" and the pointerdown; the immediate
// pointercancel keeps the 500ms hold-menu timer from firing while leaving the
// 3.5s turn window the pointerdown armed intact.
let tapped = false
for (let i = 0; i < 5 && !tapped; i++) {
  await waitFor(PARKED, 20_000, 500)
  tapped = await ev(`(() => {
    const surface = document.querySelector('[data-cube-renderer]')
    if (!surface || !(${PARKED})) return false
    const opts = { bubbles: true, pointerId: 7, isPrimary: true }
    surface.dispatchEvent(new PointerEvent('pointerdown', opts))
    surface.dispatchEvent(new PointerEvent('pointercancel', opts))
    return true
  })()`)
}
check('a touch arms the demand-scheduled spin',
  tapped && await waitFor(`window.__poplurGlobeSpin?.spinning === true`, 3000, 150),
  tapped ? JSON.stringify(await ev(`window.__poplurGlobeSpin ?? null`)) : 'tap never dispatched — parked globe never observed')
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures ? 1 : 0)
