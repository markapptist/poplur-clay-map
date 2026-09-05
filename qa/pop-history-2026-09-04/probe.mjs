#!/usr/bin/env node
// Headless proof that an opened pop shows how it grew: the profile's post
// viewer carries the growth line, its sparkline is drawn to the pop's own
// curve, and the words match the server-written history. Polls the DOM, one
// screenshot as proof.
//
//   node qa/pop-history-2026-09-04/probe.mjs [origin] [--out DIR]
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const args = process.argv.slice(2)
const ORIGIN = args.find(a => !a.startsWith('--')) ?? 'http://127.0.0.1:5173'
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(process.cwd(), 'qa/pop-history-2026-09-04/out')
const PORT = 9611 + (process.pid % 150)
mkdirSync(OUT, { recursive: true })

const profileDir = mkdtempSync(join(tmpdir(), 'poplur-byline-'))
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`,
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--use-gl=angle',
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
await cdp.send('Browser.grantPermissions', { origin: ORIGIN, permissions: ['geolocation'] })
await cdp.send('Emulation.setGeolocationOverride', { latitude: 43.6512, longitude: -79.3832, accuracy: 20 })

const ev = async (expression) => {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
  return result.value
}
const shot = async (name) => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
}
async function until(label, expression, timeoutMs = 60_000) {
  const start = Date.now()
  for (;;) {
    const value = await ev(expression).catch(() => null)
    if (value) return value
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await sleep(400)
  }
}
const report = {}

await cdp.send('Page.navigate', { url: `${ORIGIN}/?view=home&username=probe` })

// 1. Reach a profile the way a person does: tap the feed's byline. (?view=profile
//    is not a route — unknown values fall back to the feed silently.)
const byline = await until('the feed byline button', `(() => {
  const el = document.querySelector('button[data-feed-byline="true"]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { handle: el.querySelector('[aria-hidden]')?.textContent?.trim() ?? '', x: r.x + r.width / 2, y: r.y + r.height / 2 }
})()`)
report.byline = byline
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: byline.x, y: byline.y, button: 'left', clickCount: 1 })
await sleep(60)
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: byline.x, y: byline.y, button: 'left', clickCount: 1 })
await until('the visited profile grid', `Boolean(document.querySelector('h1')) && document.querySelectorAll('img').length > 1`, 30_000)
await sleep(1_200)
// The coach card ("TAP ANYWHERE TO START") covers the grid and eats the first
// tap, exactly as it does for a person arriving here the first time.
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 196, y: 620, button: 'left', clickCount: 1 })
await sleep(60)
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 196, y: 620, button: 'left', clickCount: 1 })
await until('the coach card to clear', `!/TAP ANYWHERE TO START/i.test(document.body.textContent || '')`, 15_000)
// Dismissing the coach raises the motion-permission card over the grid, the
// same as it does for a person. Answer it the way a cautious tester would.
await ev(`(() => {
  const button = [...document.querySelectorAll('button')].find(b => /don't allow/i.test(b.textContent || ''))
  if (button) button.click()
  return Boolean(button)
})()`)
await until('the permission card to clear', `!/use motion and orientation/i.test(document.body.textContent || '')`, 15_000)
await sleep(700)
await shot('1-profile-grid')

// 2. Open a pop from that grid with a real tap (a synthetic click inside the
//    page does not open the viewer; a pointer does, as a finger would).
const tile = await until('a profile tile', `(() => {
  const t = document.querySelector('button[class*="tile" i]')
  if (!t) return null
  const r = t.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})()`, 20_000)
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: tile.x, y: tile.y, button: 'left', clickCount: 1 })
await sleep(60)
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tile.x, y: tile.y, button: 'left', clickCount: 1 })
const opened = await until('an opened pop viewer', `(() => {
  const viewer = document.querySelector('[data-profile-viewer-post]')
  return viewer ? { postId: viewer.getAttribute('data-profile-viewer-post') } : null
})()`, 20_000)
report.opened = opened
await sleep(900)
await shot('2-pop-open')

// 3. The growth line, drawn from that pop's own server-written curve.
const growth = await until('the growth line', `(() => {
  const el = document.querySelector('[data-pop-growth="true"]')
  if (!el) return null
  const path = el.querySelector('path')
  return {
    label: el.getAttribute('aria-label'),
    fromMeters: Number(el.getAttribute('data-pop-growth-from-m')),
    toMeters: Number(el.getAttribute('data-pop-growth-to-m')),
    points: Number(el.getAttribute('data-pop-growth-points')),
    words: el.textContent.trim().replace(/\s+/g, ' '),
    pathData: path ? path.getAttribute('d').slice(0, 100) : null,
  }
})()`, 30_000)
report.growth = growth
if (!growth.points || growth.points < 1) throw new Error(`growth line has no points: ${JSON.stringify(growth)}`)
if (!/when posted/.test(growth.label ?? '')) throw new Error(`growth line does not say where it started: ${growth.label}`)
if (!growth.pathData) throw new Error('the sparkline drew no path')
await sleep(500)
await shot('3-growth-line')

writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
console.log(`\nOK: the opened pop says "${growth.words}" over a ${growth.points}-point curve. Proof in ${OUT}`)
process.exit(0)
