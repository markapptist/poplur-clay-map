// Notifications: white, see-through, and raining confetti like pre-login.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const BASE = process.argv[2] ?? 'http://127.0.0.1:5173'
const OUT = process.argv[3]
const PORT = 9565
const dir = mkdtempSync(join(tmpdir(), 'ntf-'))
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

await send('Page.navigate', { url: `${BASE}/?view=profile` })
// Poll for the PROFILE itself: the cube canvas paints well before ProfileTwin
// mounts, and a fixed wait after it reported "no sheet" when the owner of the
// sheet simply was not on screen yet.
// Any ProfileTwin marker will do — the username lands late on a loaded
// machine, and waiting only for it reported "no profile" on a run whose
// notification sheet then opened fine.
check('profile mounts', await waitFor(
  `document.querySelector('[class*="username"], [class*="bell"], [class*="modeSwitch"]')`, 60_000))
await sleep(800)
// The hold-menu tile is gone; the sheet answers this event (its documented route).
await ev(`window.dispatchEvent(new CustomEvent('poplur-open-notifications'))`)
check('notifications sheet opens', await waitFor(`document.querySelector('[class*="notifBanner"]')`, 8000))
await sleep(1500)

const look = await ev(`(() => {
  // The BELL BUTTON also carries aria-label="Notifications", and querySelector
  // returns it first — measuring it reported the sheet as transparent with
  // white text when the sheet itself was correct. Target the sheet's own class.
  const sheet = document.querySelector('[class*="notifBanner"]')
  const cs = getComputedStyle(sheet)
  const m = cs.backgroundColor.match(/rgba?\\(([^)]+)\\)/)
  const parts = m ? m[1].split(',').map(Number) : []
  return {
    bg: cs.backgroundColor,
    r: parts[0], g: parts[1], b: parts[2],
    alpha: parts.length > 3 ? parts[3] : 1,
    blur: cs.backdropFilter || cs.webkitBackdropFilter || 'none',
    ink: cs.color,
  }
})()`)
check('sheet is WHITE', look.r > 240 && look.g > 240 && look.b > 240, look.bg)
check('sheet is SEE-THROUGH', look.alpha > 0 && look.alpha < 1, `alpha ${look.alpha}`)
check('text is dark on the white', /rgb\((\d{1,2}|1\d\d),/.test(look.ink), look.ink)

// confetti: present, coloured, and actually MOVING
const c1 = await ev(`(() => {
  const box = document.querySelector('[class*="confetti"]')
  if (!box) return null
  const bits = [...box.children]
  return { n: bits.length, colors: [...new Set(bits.slice(0, 40).map(b => b.style.background))].length,
           first: bits[0]?.style.transform ?? '' }
})()`)
check('confetti is falling in the sheet', (c1?.n ?? 0) > 20, `${c1?.n} pieces`)
check('multiple confetti colours (pre-login palette)', (c1?.colors ?? 0) >= 3, `${c1?.colors} colours`)
// Sample the WHOLE set across a longer window. Watching one particle for
// 900ms was flaky for two reasons that have nothing to do with the app:
// headless rAF runs at a few fps under load, and children[0] is the OLDEST
// piece — often one frame from being removed.
const moved = await ev(`(async () => {
  const box = document.querySelector('[class*="confetti"]')
  const read = () => [...box.children].slice(0, 30).map(b => b.style.transform).join('|')
  const before = read()
  await new Promise(r => setTimeout(r, 2500))
  const after = read()
  return { changed: before !== after, sample: after.split('|')[0] ?? '' }
})()`)
check('the confetti actually moves', moved.changed === true, String(moved.sample).slice(0, 40))
if (OUT) { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r?.result?.data) writeFileSync(join(OUT, 'notifs-frost.png'), Buffer.from(r.result.data, 'base64')) }

// and it must stop when the sheet closes (no orphaned loop)
// The SCRIM owns the close handler (banner → motion shell → scrim), and the
// sheet plays a closing animation before it unmounts, so poll rather than
// guessing a duration.
await ev(`(() => {
  const banner = document.querySelector('[class*="notifBanner"]')
  const scrim = banner?.parentElement?.parentElement
  scrim?.click()
  return !!scrim
})()`)
const closed = await waitFor(`!document.querySelector('[class*="notifBanner"]')`, 8000)
check('sheet closes', closed)
check('confetti loop is gone with it (no orphan)',
  !(await ev(`!!document.querySelector('[class*="confetti"]')`)))
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures ? 1 : 0)
