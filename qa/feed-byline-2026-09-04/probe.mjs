#!/usr/bin/env node
// Headless proof that pressing the feed's username label opens the poster's
// profile. Driven in the REAL shell (5173 ?view=home), polling the DOM, one
// screenshot as proof at the end (headless_probe_over_screenshot).
//
//   node qa/feed-byline-2026-09-04/probe.mjs [origin] [--out DIR]
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const args = process.argv.slice(2)
const ORIGIN = args.find(a => !a.startsWith('--')) ?? 'http://127.0.0.1:5173'
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(process.cwd(), 'qa/feed-byline-2026-09-04/out')
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
// 1. The feed shows a post, and its byline is a BUTTON naming the poster.
const byline = await until('the feed byline button', `(() => {
  const el = document.querySelector('button[data-feed-byline="true"]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { label: el.getAttribute('aria-label'), handle: el.querySelector('[aria-hidden]')?.textContent?.trim() ?? '', x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, tag: el.tagName }
})()`)
report.byline = byline
if (!byline.handle.startsWith('@')) throw new Error(`byline shows no handle: ${JSON.stringify(byline)}`)
if (!/Open .*profile/.test(byline.label ?? '')) throw new Error(`byline is not labelled as the profile opener: ${byline.label}`)
// No profile is up before the tap.
report.profileBefore = await ev(`Boolean(document.querySelector('[data-verified-kind]'))`)
if (report.profileBefore) throw new Error('a profile header is already on screen before the tap')
await shot('1-feed-byline')

// 2. A real tap on the cell (pointer + mouse, the way a finger arrives).
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: byline.x, y: byline.y, button: 'left', clickCount: 1 })
await sleep(60)
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: byline.x, y: byline.y, button: 'left', clickCount: 1 })

// 3. The profile tab mounts for THAT poster: the visited header carries the
//    handle (upper-cased, sans @) and the verified mark; the feed byline is gone.
const wanted = byline.handle.replace(/^@/, '').toUpperCase()
const profile = await until('the visited profile header', `(() => {
  const h1 = document.querySelector('h1')
  if (!h1) return null
  const text = h1.textContent?.trim() ?? ''
  if (!text) return null
  return { header: text, verified: h1.querySelector('[data-verified-kind]')?.getAttribute('data-verified-kind') ?? null, bylineStillThere: Boolean(document.querySelector('button[data-feed-byline="true"]')), holdMenu: Boolean(document.querySelector('[data-hold-menu], [aria-label="Hold menu"]')) }
})()`, 30_000)
report.profile = profile
if (!profile.header.includes(wanted)) throw new Error(`profile header "${profile.header}" is not the poster ${wanted}`)
if (profile.bylineStillThere) throw new Error('the feed byline is still on screen — the tab never changed')
if (profile.holdMenu) throw new Error('the tap armed the hold menu')
await sleep(1_200)
await shot('2-poster-profile')

writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
console.log(`\nOK: tapping "${byline.handle}" on the feed opened ${profile.header} (mark: ${profile.verified}). Proof in ${OUT}`)
process.exit(0)
