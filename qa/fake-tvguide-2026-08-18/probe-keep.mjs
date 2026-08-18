import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const PORT = 9537
const dir = mkdtempSync(join(tmpdir(), 'keep-'))
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
  '--window-size=430,932', '--mute-audio', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
], { stdio: 'ignore' })
process.on('exit', () => { try { chrome.kill() } catch {}; try { rmSync(dir, { recursive: true, force: true }) } catch {} })
const sleep = ms => new Promise(r => setTimeout(r, ms))
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
const waitFor = async (e, ms, s = 350) => { const u = Date.now() + ms; while (Date.now() < u) { if (await ev(`!!(${e})`)) return true; await sleep(s) } return false }

// ONLY a legitimate record this time.
await send('Page.enable')
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  try { localStorage.setItem('poplur.tab.lastScreen.v1', JSON.stringify({ map: 'map-radio' })) } catch {}
` })
await send('Page.navigate', { url: 'http://127.0.0.1:5173/?view=map' })
await waitFor(`document.querySelector('[class*="cubeWrap"] canvas')`, 30_000)
await sleep(5000)
const radio = await waitFor(`document.querySelector('[role=dialog][aria-label*="radio" i]')`, 12_000)
console.log('dialogs on screen  :', JSON.stringify(await ev(`[...document.querySelectorAll('[role=dialog]')].map(d => d.getAttribute('aria-label'))`)))
console.log('subscreen stage    :', await ev(`document.querySelector('[data-testid="rcl-subscreen"]')?.dataset.screen ?? 'none'`))
console.log('wheel present      :', await ev(`!!document.querySelector('[role=dialog][aria-label*="hold menu" i]')`))
const stored = await ev(`localStorage.getItem('poplur.tab.lastScreen.v1')`)
console.log('RADIO resumed on map:', radio)
console.log('storage after boot   :', stored)
process.exit(radio ? 0 : 1)
