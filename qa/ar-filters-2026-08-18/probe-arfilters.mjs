// Picking an AR filter must change the LIVE viewfinder. `filterCss` was
// computed and handed only to the capture canvas, so the rail graded the photo
// you took and left the preview untouched — which is what "the filters don't
// work" looked like in a browser.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const BASE = process.argv[2] ?? 'http://127.0.0.1:5173'
const OUT = process.argv[3]
const PORT = 9585
const dir = mkdtempSync(join(tmpdir(), 'arf-'))
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
await send('Page.enable')
const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.result?.value
const waitFor = async (e, ms, s = 300) => { const u = Date.now() + ms; while (Date.now() < u) { if (await ev(`!!(${e})`)) return true; await sleep(s) } return false }
const shot = async n => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r?.result?.data && OUT) writeFileSync(join(OUT, n), Buffer.from(r.result.data, 'base64')) }
const liveFilter = () => ev(`(()=>{const v=[...document.querySelectorAll('video')].find(v=>v.srcObject);return v?getComputedStyle(v).filter:'NO VIDEO'})()`)
const centred = () => ev(`(document.querySelector('[data-idx][aria-pressed=true]')||{}).getAttribute && document.querySelector('[data-idx][aria-pressed=true]').getAttribute('aria-label')`)
// The rail advances on ArrowRight; a tap works too but the rail CULLS chips
// more than 3.2 slots out, so anything far along the list is not in the DOM.
// Drives the rail the way a FINGER does: pointerdown/up on a chip, under the
// 6px tap threshold. Deliberately not the arrow keys — those move the rail on
// the dev server and do nothing against a production bundle, so an arrow-based
// probe passes in dev and reports the shipped bytes as broken. Taps work on
// both, and they are the interaction a phone actually has.
//
// Waits for the rail to ARRIVE rather than sleeping a fixed time: the snap is
// animated, so reading the grade too early reads the previous filter.
const stepRight = async () => {
  const before = await centred()
  await ev(`(async () => {
    const chips = [...document.querySelectorAll('[data-idx]')]
    const here = chips.findIndex(c => c.getAttribute('aria-pressed') === 'true')
    // The rail CULLS chips more than 3.2 slots out, so "one to the right" is
    // the next one present in the DOM, not the next id in AR_FILTERS.
    const next = chips[here + 1] ?? chips[chips.length - 1]
    if (!next) return false
    const line = next.closest('div')
    const r = next.getBoundingClientRect(); const x = r.x + r.width/2, y = r.y + r.height/2
    const fire = (ty, buttons) => line.dispatchEvent(new PointerEvent(ty, {
      bubbles:true, cancelable:true, composed:true, pointerId:21, pointerType:'touch',
      isPrimary:true, clientX:x, clientY:y, buttons }))
    fire('pointerdown',1); await new Promise(f=>setTimeout(f,70)); fire('pointerup',0)
    return true })()`)
  const until = Date.now() + 6000
  while (Date.now() < until) {
    await sleep(200)
    if ((await centred()) !== before) { await sleep(500); return }
  }
}

for (let a = 0; a < 3; a++) {
  await send('Page.navigate', { url: `${BASE}/?view=camera` })
  if (await waitFor(`[...document.querySelectorAll('video')].some(v => v.srcObject)`, 50_000)) break
}
await sleep(2500)
check('the live viewfinder is up', (await liveFilter()) !== 'NO VIDEO')
check('no filter to start with', (await liveFilter()) === 'none')

await ev(`[...document.querySelectorAll('button')].find(b => /augmented reality/i.test(b.getAttribute('aria-label')||'')).click()`)
check('the AR rail opens', await waitFor(`document.querySelector('[data-idx]')`, 6000))
await shot('ar-rail-open.png')

// Walk the rail and prove each selection reaches the picture.
const seen = []
for (let i = 0; i < 5; i++) {
  await stepRight()
  const label = await centred()
  const css = await liveFilter()
  seen.push({ label, graded: css !== 'none' && css !== 'NO VIDEO' })
  console.log(`      ${label} -> ${String(css).slice(0, 62)}${String(css).length > 62 ? '…' : ''}`)
}
check('every filter stepped through grades the live preview',
  seen.length === 5 && seen.every(s => s.graded),
  seen.map(s => `${s.label}:${s.graded ? 'ok' : 'DEAD'}`).join('  '))
check('the grades actually differ from one another',
  new Set(seen.map(s => s.label)).size === 5, seen.map(s => s.label).join(' · '))
await shot('ar-filter-applied.png')

// …and going back to None must clear it, not leave the last grade stuck on.
// Spaced deliberately: the handler derives its target from `selected` state,
// so arrows fired faster than a render all compute the SAME next index and
// collapse into one step. That is a keyboard-only nicety on a touch-scrub
// rail, not the thing under test — but firing them in a tight loop makes this
// probe report a stuck grade that the product does not actually have.
// Mirror of stepRight, one chip at a time, waiting for each snap to land.
const stepLeft = async () => {
  const before = await centred()
  await ev(`(async () => {
    const chips = [...document.querySelectorAll('[data-idx]')]
    const here = chips.findIndex(c => c.getAttribute('aria-pressed') === 'true')
    const prev = chips[here - 1] ?? chips[0]
    if (!prev || here <= 0) return false
    const line = prev.closest('div')
    const r = prev.getBoundingClientRect(); const x = r.x + r.width/2, y = r.y + r.height/2
    const fire = (ty, buttons) => line.dispatchEvent(new PointerEvent(ty, {
      bubbles:true, cancelable:true, composed:true, pointerId:22, pointerType:'touch',
      isPrimary:true, clientX:x, clientY:y, buttons }))
    fire('pointerdown',1); await new Promise(f=>setTimeout(f,70)); fire('pointerup',0)
    return true })()`)
  const until = Date.now() + 6000
  while (Date.now() < until) {
    await sleep(200)
    if ((await centred()) !== before) { await sleep(400); return }
  }
}
for (let i = 0; i < 8 && (await centred()) !== 'None'; i++) await stepLeft()
await sleep(1000)
check('returning to None clears the grade', (await liveFilter()) === 'none', await liveFilter())

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
