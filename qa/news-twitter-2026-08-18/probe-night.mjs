import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const PORT = 9553
const dir = mkdtempSync(join(tmpdir(), 'nite-'))
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
  '--window-size=430,932', '--force-device-scale-factor=2', '--mute-audio',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
], { stdio: 'ignore' })
process.on('exit', () => { try { chrome.kill() } catch {}; try { rmSync(dir, { recursive: true, force: true }) } catch {} })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let t
for (let i = 0; i < 60 && !t; i++) { try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(x => x.type === 'page') } catch {}; if (!t) await sleep(500) }
const ws = new WebSocket(t.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
await new Promise(r => ws.addEventListener('open', r))
const send = (m, p = {}) => new Promise(res => { const i = ++id; pending.set(i, res); setTimeout(() => { pending.delete(i); res({}) }, 30000); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.result?.value
const waitFor = async (e, ms, s = 350) => { const u = Date.now() + ms; while (Date.now() < u) { if (await ev(`!!(${e})`)) return true; await sleep(s) } return false }

// Boot with the clock at 02:00 so localDaylight() reports night.
await send('Page.enable')
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  (() => {
    const Real = Date
    const night = new Real(); night.setHours(2, 0, 0, 0)
    const shift = night.getTime() - Real.now()
    function Fake(...a) { return a.length ? new Real(...a) : new Real(Real.now() + shift) }
    Fake.now = () => Real.now() + shift
    Fake.parse = Real.parse; Fake.UTC = Real.UTC; Fake.prototype = Real.prototype
    window.Date = Fake
  })()
` })
await send('Page.navigate', { url: 'http://127.0.0.1:5173/?view=holdmenu&holdScreen=feed-news' })
await waitFor(`document.querySelector('[data-daylight]')`, 30000)
await sleep(3000)
console.log('mode      :', await ev(`document.querySelector('[data-daylight]')?.dataset.daylight`))
console.log('background:', await ev(`getComputedStyle(document.querySelector('[data-daylight]')).backgroundColor`))
console.log('body ink  :', await ev(`getComputedStyle(document.querySelector('[data-daylight]')).color`))
const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot?.result?.data) writeFileSync(process.argv[2], Buffer.from(shot.result.data, 'base64'))
process.exit(0)
