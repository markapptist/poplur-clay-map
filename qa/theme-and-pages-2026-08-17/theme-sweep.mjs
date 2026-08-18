import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const OUT = process.argv[2]
const THEME = process.argv[3] ?? '' // '' = default
const SCREENS = ['map-radio', 'camera-studio', 'feed-tvguide']
const PORT = 9507
const dir = mkdtempSync(join(tmpdir(), 'theme-'))
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
  '--window-size=430,932', '--mute-audio', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
], { stdio: 'ignore' })
process.on('exit', () => { try { chrome.kill() } catch {}; try { rmSync(dir, { recursive: true, force: true }) } catch {} })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let target
for (let i = 0; i < 50 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(t => t.type === 'page') } catch {}
  if (!target) await sleep(400)
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
await new Promise(r => ws.addEventListener('open', r))
const send = (m, p = {}) => new Promise(res => { const i = ++id; pending.set(i, res); setTimeout(() => { pending.delete(i); res({}) }, 25000); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.result?.value
if (THEME) {
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('poplur.profile.theme.v1', '${THEME}') } catch {}` })
}
for (const screen of SCREENS) {
  await send('Page.navigate', { url: `http://127.0.0.1:5173/?view=holdmenu&holdScreen=${screen}` })
  for (let i = 0; i < 40; i++) { if (await ev(`!!document.querySelector('[role=dialog]')`)) break; await sleep(500) }
  await sleep(6500)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  if (shot?.result?.data) writeFileSync(join(OUT, `theme${THEME ? '-' + THEME : ''}-${screen}.png`), Buffer.from(shot.result.data, 'base64'))
  console.log('shot', screen)
}
process.exit(0)
