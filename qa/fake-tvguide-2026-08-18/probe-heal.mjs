// A phone poisoned by the arrow-walk bug (door ids saved as pages) must heal
// itself on the next launch: no mock TV Guide, no stray wheel, clean storage.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const BASE = process.argv[2] ?? 'http://127.0.0.1:5173'
const PORT = 9533
const dir = mkdtempSync(join(tmpdir(), 'heal-'))
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
  '--window-size=430,932', '--mute-audio', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
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

// Poison storage exactly as the buggy build would have, on both tabs.
await send('Page.enable')
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  try { localStorage.setItem('poplur.tab.lastScreen.v1',
    JSON.stringify({ profile: 'profile-home', feed: 'feed-home', map: 'map-radio' })) } catch {}
` })

for (const [tab, view] of [['profile', 'profile'], ['feed', 'feed']]) {
  await send('Page.navigate', { url: `${BASE}/?view=${view}` })
  await waitFor(`document.querySelector('[class*="cubeWrap"] canvas')`, 30_000)
  await sleep(4000)
  const state = await ev(`(() => ({
    tvguide: document.body.innerText.toUpperCase().includes('LIVE CHANNELS') || document.body.innerText.toUpperCase().includes('ON NOW'),
    embed: document.querySelector('[data-testid="rcl-subscreen"]')?.dataset.screen ?? null,
    wheel: !!document.querySelector('[role=dialog][aria-label*="hold menu" i]'),
  }))()`)
  check(`${tab}: no mock TV Guide after a poisoned record`, !state.tvguide, JSON.stringify(state))
  check(`${tab}: no door opened as a page`, !String(state.embed ?? '').endsWith('-home'), `embed=${state.embed}`)
  check(`${tab}: no stray wheel on launch`, !state.wheel)
}
// The valid record (map-radio) must SURVIVE the scrub.
const kept = await ev(`JSON.parse(localStorage.getItem('poplur.tab.lastScreen.v1') || '{}')`)
check('a legitimate saved page still resumes', kept && kept.map === 'map-radio', JSON.stringify(kept))
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures ? 1 : 0)
