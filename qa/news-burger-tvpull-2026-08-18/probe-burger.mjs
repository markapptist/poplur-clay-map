// News hamburger: opens, search really filters, Profile lands on Messages.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const BASE = process.argv[2] ?? 'http://127.0.0.1:5173'
const OUT = process.argv[3]
const PORT = 9545
const dir = mkdtempSync(join(tmpdir(), 'bg-'))
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

await send('Page.navigate', { url: `${BASE}/?view=holdmenu&holdScreen=feed-news` })
check('news mounts', await waitFor(`document.querySelector('[data-pull-panel]')`, 30_000))
await sleep(2500)

check('hamburger is visible', await ev(`!!document.querySelector('[aria-label="Open news menu"]')`))
const before = await ev(`document.querySelectorAll('[class*="timeline"] article').length`)
await ev(`document.querySelector('[aria-label="Open news menu"]').click()`)
check('drawer opens', await waitFor(`document.querySelector('[role=dialog][aria-label="News menu"]')`, 5000))
await shot('news-drawer.png')

// Search must really filter the edition.
await ev(`(() => {
  const input = document.querySelector('[aria-label="Search for a post"]')
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  set.call(input, 'mural')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
await sleep(700)
const after = await ev(`document.querySelectorAll('[class*="timeline"] article').length`)
const countLine = await ev(`document.querySelector('[class*="searchCount"]')?.textContent ?? ''`)
check('search filters the timeline', after > 0 && after < before, `${before} → ${after} stories`)
check('search reports the count', /stor(y|ies) in reach/.test(countLine), countLine)
const allMatch = await ev(`[...document.querySelectorAll('[class*="timeline"] article')].every(a => a.textContent.toLowerCase().includes('mural'))`)
check('every remaining story matches the query', allMatch === true)
await shot('news-search.png')

// A query with no hits says so rather than showing an empty paper.
await ev(`(() => {
  const input = document.querySelector('[aria-label="Search for a post"]')
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  set.call(input, 'zzzznotathing'); input.dispatchEvent(new Event('input', { bubbles: true })); return true
})()`)
await sleep(600)
check('no-hit search explains itself', await ev(`!!document.querySelector('[class*="noHits"]')`))

// Profile row → profile tab, Messages mode.
await ev(`(() => {
  const input = document.querySelector('[aria-label="Search for a post"]')
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  set.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })); return true
})()`)
await sleep(300)
await ev(`[...document.querySelectorAll('[class*="drawerRow"]')].find(b => /Profile/.test(b.textContent)).click()`)
await sleep(2500)
check('news closed, profile is up', await waitFor(`document.querySelector('[class*="avatarWrap"], [class*="modeLabel"]')`, 15_000))
const mode = await ev(`[...document.querySelectorAll('[class*="modeLabel"]')].map(e => ({ t: e.textContent, on: (e.closest('button')?.className || '').includes('modeOn') }))`)
check('landed on the Messages tab', Array.isArray(mode) && mode.some(m => /Messages/i.test(m.t) && m.on), JSON.stringify(mode))
await shot('news-to-messages.png')
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures ? 1 : 0)
