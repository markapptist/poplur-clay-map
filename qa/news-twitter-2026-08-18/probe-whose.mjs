// Opening a profile from News must land on THEIR profile — and the drawer's
// own Profile row must still mean YOU.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const BASE = process.argv[2] ?? 'http://127.0.0.1:5173'
const OUT = process.argv[3]
const PORT = 9557
const dir = mkdtempSync(join(tmpdir(), 'who-'))
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
const shot = async n => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r?.result?.data && OUT) writeFileSync(join(OUT, n), Buffer.from(r.result.data, 'base64')) }
const nameOnProfile = `document.querySelector('[class*="username"]')?.textContent?.trim()`
const messagesOn = `[...document.querySelectorAll('[class*="modeLabel"]')].some(e => /Messages/i.test(e.textContent) && (e.closest('button')?.className||'').includes('modeOn'))`

// ── from a POST detail: their profile ──────────────────────────────────────
await send('Page.navigate', { url: `${BASE}/?view=holdmenu&holdScreen=feed-news` })
await waitFor(`document.querySelector('[class*="timeline"] article')`, 30_000)
await sleep(2500)
const author = await ev(`(() => {
  const a = document.querySelector('[class*="timeline"] article')
  return { who: a.querySelector('[class*="who"]')?.textContent?.trim(),
           handle: a.querySelector('[class*="handle"]')?.textContent?.trim() }
})()`)
await ev(`document.querySelector('[class*="timeline"] article').click()`)
await waitFor(`document.querySelector('[class*="detailProfile"]')`, 8000)
await ev(`document.querySelector('[class*="detailProfile"]').click()`)
check('profile opens', await waitFor(nameOnProfile, 15_000))
await sleep(1200)
const landed = await ev(nameOnProfile)
const expected = (author?.handle ?? '').replace(/^@/, '').toUpperCase()
check('landed on THEIR profile, not mine', landed === expected, `author ${author?.handle} → showing "${landed}" (expected "${expected}")`)
check('and on the Messages tab', await ev(messagesOn))
await shot('whose-their-profile.png')

// ── from the DRAWER's own row: my profile ──────────────────────────────────
await send('Page.navigate', { url: `${BASE}/?view=holdmenu&holdScreen=feed-news` })
await waitFor(`document.querySelector('[aria-label="Open news menu"]')`, 30_000)
await sleep(2200)
await ev(`document.querySelector('[aria-label="Open news menu"]').click()`)
await waitFor(`document.querySelector('[class*="drawerRow"]')`, 6000)
await ev(`document.querySelector('[class*="drawerRow"]').click()`)
check('drawer profile opens', await waitFor(nameOnProfile, 15_000))
await sleep(1200)
const mine = await ev(nameOnProfile)
check("drawer's own row still means MY profile", mine !== expected && !!mine, `showing "${mine}"`)
check('also on Messages', await ev(messagesOn))
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures ? 1 : 0)
