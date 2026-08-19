// Does the pet run on EVERY pull, and does a pop actually get scheduled?
// Chrome launched WITHOUT an autoplay override so the AudioContext starts
// suspended, the way it does on iOS.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const BASE = process.argv[2] ?? 'http://127.0.0.1:5173'
const OUT = process.argv[3]
const PORT = 9529
const dir = mkdtempSync(join(tmpdir(), 'pet-'))
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
  '--window-size=430,932', '--force-device-scale-factor=2',
], { stdio: 'ignore' })
process.on('exit', () => { try { chrome.kill() } catch {}; try { rmSync(dir, { recursive: true, force: true }) } catch {} })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (n, ok, d = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `  — ${d}` : ''}`) }
let target
for (let i = 0; i < 60 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(t => t.type === 'page') } catch {}
  if (!target) await sleep(500)
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
await new Promise(r => ws.addEventListener('open', r))
const send = (m, p = {}) => new Promise(res => { const i = ++id; pending.set(i, res); setTimeout(() => { pending.delete(i); res({ timedOut: true }) }, 40000); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.result?.value
const waitFor = async (e, ms, step = 350) => { const u = Date.now() + ms; while (Date.now() < u) { if (await ev(`!!(${e})`)) return true; await sleep(step) } return false }

// Only patch the buffer-source start: records that a pop was scheduled AND the
// context state at that moment. No constructor patching (that broke boot).
await send('Page.navigate', { url: `${BASE}/?view=holdmenu&holdScreen=feed-tvguide` })
check('news mounts', await waitFor(`document.querySelector('[data-pull-panel]')`, 30_000))
await sleep(2500)
await ev(`(() => {
  window.__pops = []
  const realStart = AudioBufferSourceNode.prototype.start
  AudioBufferSourceNode.prototype.start = function (...a) {
    try { window.__pops.push(this.context.state) } catch {}
    return realStart.apply(this, a)
  }
  return true
})()`)
check('audio instrumentation attached', (await ev(`Array.isArray(window.__pops)`)) === true)

const FIRE = `(el, t, x, y) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, buttons: t === 'pointerup' ? 0 : 1 }))`
const PET = `(() => {
  const p = document.querySelector('[data-pull-panel]')
  const r = [...p.querySelectorAll('img')].find(i => /poplurgatchi/.test(i.src))
  if (!r) return { found: false }
  const rect = r.getBoundingClientRect(), host = p.parentElement.getBoundingClientRect()
  return { found: true, display: getComputedStyle(r).display, anims: r.getAnimations().length,
           onScreen: rect.bottom > host.top && rect.top < host.bottom && rect.width > 0 }
})()`
const pull = async px => ev(`(async () => {
  const fire = ${FIRE}
  const host = document.querySelector('[data-pull-panel]').parentElement
  const r = host.getBoundingClientRect(); const x = r.x + r.width/2; let y = r.y + 80
  fire(host, 'pointerdown', x, y)
  for (let s = 0; s < 14; s++) { y += ${px}/14; fire(host, 'pointermove', x, y); await new Promise(f => setTimeout(f, 16)) }
  window.__up = () => fire(host, 'pointerup', x, y)
  return true
})()`)

// ── A SHORT pull (past crest 30, under commit 68): pet must still run ───────
await ev(`window.__pops.length = 0`)
await pull(95)               // ×0.55 resist ≈ 52px: crested, not committed
await sleep(260)
const short = await ev(PET)
check('pet runs on a SHORT (uncommitted) pull', short.found && short.display === 'block' && short.onScreen, JSON.stringify(short))
check('pop scheduled on the short pull', (await ev(`window.__pops.length`)) >= 1, `ctx states: ${JSON.stringify(await ev(`window.__pops`))}`)
if (OUT) { const s = await send('Page.captureScreenshot', { format: 'png' }); if (s?.result?.data) writeFileSync(OUT, Buffer.from(s.result.data, 'base64')) }
await ev(`window.__up()`)
await sleep(900)
check('pet leaves with the curtain', !(await ev(PET)).onScreen || (await ev(PET)).display === 'none')

// ── A COMMITTED pull: pet runs through the refresh ─────────────────────────
await ev(`window.__pops.length = 0`)
await pull(260)
await sleep(200)
await ev(`window.__up()`)
await sleep(300)
const busy = await ev(PET)
check('pet runs through the refresh', busy.found && busy.display === 'block' && busy.onScreen, JSON.stringify(busy))
check('pops scheduled on the committed pull', (await ev(`window.__pops.length`)) >= 1, `${await ev(`window.__pops.length`)} pop(s)`)
await sleep(1800)
check('pet gone once the curtain closed', (await ev(PET)).display === 'none')
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures ? 1 : 0)
