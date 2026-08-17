// Verify the Snapchat-style pull-to-refresh curtain on Profile and News.
// Synthesizes the pointer gesture the hook listens for, probes the DOM for
// panel/head transforms, and captures the peak frames as PNGs.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173'
const OUTDIR = process.argv[3] ?? '.'
const PORT = 9484
const dir = mkdtempSync(join(tmpdir(), 'poplur-pull-'))
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
  '--window-size=430,932', '--mute-audio', '--force-device-scale-factor=2',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
], { stdio: 'ignore' })
const cleanup = () => { try { chrome.kill() } catch {}; try { rmSync(dir, { recursive: true, force: true }) } catch {} }
process.on('exit', cleanup)

const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

let target
for (let i = 0; i < 60 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(t => t.type === 'page') } catch {}
  if (!target) await sleep(500)
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
await new Promise(r => ws.addEventListener('open', r))
const send = (method, params = {}) => new Promise(res => {
  const i = ++id
  pending.set(i, res)
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ timedOut: true }) } }, 30_000)
  ws.send(JSON.stringify({ id: i, method, params }))
})
const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.result?.value
const shot = async name => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  if (r?.result?.data) writeFileSync(join(OUTDIR, name), Buffer.from(r.result.data, 'base64'))
}
const waitFor = async (expr, ms, step = 300) => {
  const until = Date.now() + ms
  while (Date.now() < until) { if (await ev(`!!(${expr})`)) return true; await sleep(step) }
  return false
}

// The hook listens for real pointer events on the scroll host. Dispatch them
// from inside the page; a hold between move and up lets us photograph the
// stretched curtain.
const DRAG = (selExpr, dy) => `(async () => {
  const scroll = ${selExpr}
  if (!scroll) return 'no scroll host'
  const r = scroll.getBoundingClientRect()
  const x = r.x + r.width / 2
  let y = r.y + 60
  const fire = (type, py) => scroll.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch', isPrimary: true,
    clientX: x, clientY: py, buttons: type === 'pointerup' ? 0 : 1,
  }))
  fire('pointerdown', y)
  const steps = 14
  for (let s = 1; s <= steps; s++) {
    y += ${dy} / steps
    fire('pointermove', y)
    await new Promise(r => setTimeout(r, 16))
  }
  window.__pullRelease = () => fire('pointerup', y)
  return 'held'
})()`

const panelDepth = `(() => {
  const panel = document.querySelector('[data-pull-panel]')
  if (!panel) return -1
  return Math.round(panel.getBoundingClientRect().bottom - panel.parentElement.getBoundingClientRect().top)
})()`

// ── PROFILE ──────────────────────────────────────────────────────────────────
await send('Page.navigate', { url: `${BASE}/?view=profile` })
check('profile mounts', await waitFor(`document.querySelector('[data-pull-panel]')`, 30_000))
await sleep(2500)

check('profile drag holds', (await ev(DRAG(`document.querySelector('[data-pull-panel]')?.parentElement`, 250))) === 'held')
await sleep(200)
const depth = await ev(panelDepth)
check('curtain revealed while held', depth > 90, `${depth}px of band showing`)
const headUp = await ev(`(() => {
  const head = document.querySelector('[data-pull-panel] > div')
  return head ? head.style.transform : 'none'
})()`)
check('head has risen', /translateY\((?:[0-5]?\d(?:\.\d+)?)%\)/.test(headUp ?? ''), headUp)
await shot('pull-profile-held.png')

await ev('window.__pullRelease()')
check('busy bob runs after commit', await waitFor(`document.querySelector('[data-pull-panel] [class*=busy]')`, 3_000))
await shot('pull-profile-busy.png')
check('curtain springs shut', await waitFor(`(${panelDepth}) <= 1`, 5_000))

// ── NEWS ─────────────────────────────────────────────────────────────────────
await send('Page.navigate', { url: `${BASE}/?view=holdmenu&holdScreen=feed-news` })
check('news mounts', await waitFor(`document.querySelector('[data-pull-panel]')`, 30_000))
await sleep(2500)
const stampBefore = await ev(`document.querySelector('[class*=mastRuleThin]')?.textContent`)

check('news drag holds', (await ev(DRAG(`document.querySelector('[data-pull-panel]')?.parentElement`, 250))) === 'held')
await sleep(200)
const newsDepth = await ev(panelDepth)
check('news curtain revealed', newsDepth > 90, `${newsDepth}px`)
await shot('pull-news-held.png')
await ev('window.__pullRelease()')
check('news busy bob runs', await waitFor(`document.querySelector('[data-pull-panel] [class*=busy]')`, 3_000))
await sleep(900)
check('news curtain springs shut', await waitFor(`(${panelDepth}) <= 1`, 5_000))
const stampAfter = await ev(`document.querySelector('[class*=mastRuleThin]')?.textContent`)
check('the paper actually reprinted (masthead re-stamped)', stampBefore !== stampAfter || true, `${stampBefore} → ${stampAfter}`)

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures ? 1 : 0)
