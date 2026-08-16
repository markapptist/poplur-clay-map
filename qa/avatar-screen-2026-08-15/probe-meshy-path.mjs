// The paid path's money handling, without a real Meshy behind it:
//   1. no endpoint configured → honest message, NO debit
//   2. endpoint configured but dead → debit up front, REFUND on failure
// Also captures screenshots of the three stages for the handoff.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = 'http://127.0.0.1:5173'
const PORT = 9473
const SHOTS = process.argv[2] || '.'
const dir = mkdtempSync(join(tmpdir(), 'poplur-meshy-'))
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
  '--window-size=430,932', '--mute-audio',
], { stdio: 'ignore' })
const cleanup = () => { try { chrome.kill() } catch {} ; try { rmSync(dir, { recursive: true, force: true }) } catch {} }
process.on('exit', cleanup)

const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

let target
for (let i = 0; i < 60 && !target; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
    target = list.find(t => t.type === 'page')
  } catch {}
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
const ev = async expression =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))?.result?.result?.value
const waitFor = async (expr, ms, step = 400) => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (await ev(`!!(${expr})`)) return true
    await sleep(step)
  }
  return false
}
const clickText = text => ev(`(() => {
  const hit = [...document.querySelectorAll('button')]
    .find(b => b.textContent.replace(/\\s+/g, ' ').toUpperCase().includes(${JSON.stringify(text.toUpperCase())}))
  if (!hit) return false
  hit.click()
  return true
})()`)
const balance = () => ev(`JSON.parse(localStorage.getItem('poplur.credits.ledger.v1') || '[]').reduce((t, e) => t + e.delta, 0)`)
const shot = async name => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  if (r?.result?.data) writeFileSync(join(SHOTS, name), Buffer.from(r.result.data, 'base64'))
}

const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC'
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    try {
      if (!localStorage.getItem('__probe_seeded')) {
        localStorage.setItem('__probe_seeded', '1')
        localStorage.removeItem('poplur.credits.ledger.v1')
        localStorage.removeItem('poplur.avatar.cubes.v1')
        localStorage.removeItem('poplur.avatar.worn.v1')
        localStorage.setItem('poplur.profile.photo', ${JSON.stringify(LOGO)})
        indexedDB.deleteDatabase('poplur-avatar-cubes')
      }
    } catch (e) {}
  `,
})
await send('Page.enable')

// ── 1. unconfigured: message, no debit ──────────────────────────────────────
await send('Page.navigate', { url: `${BASE}/?view=holdmenu&holdScreen=profile-avatar` })
await waitFor(`document.querySelector('[data-poplur-screen="avatar"]')`, 25_000)
await sleep(800)
await shot('avatar-shelf.png')
await clickText('USE MY PROFILE PICTURE')
await waitFor(`[...document.querySelectorAll('button')].some(b => /SCULPT WITH MESHY/.test(b.textContent))`, 8_000)
await sleep(500)
await shot('avatar-style.png')
await clickText('SCULPT WITH MESHY')
check('unconfigured sculpt says where it runs', await waitFor(
  `[...document.querySelectorAll('p')].some(p => /runs on your Poplur account|not switched on/.test(p.textContent))`, 5_000))
check('unconfigured sculpt did not charge', (await balance()) === 30, `balance ${await balance()}`)

// ── 2. dead endpoint: debit, then refund on failure ─────────────────────────
await ev(`localStorage.setItem('poplur.meshy.endpoint', 'http://127.0.0.1:9')`)
await clickText('SCULPT WITH MESHY')
check('working stage appears', await waitFor(`document.body.innerText.includes('MAKING YOUR CUBE')`, 6_000))
await shot('avatar-working.png')
check('the 25 was debited up front', (await balance()) === 5, `balance ${await balance()}`)
check('failure returns to the style step', await waitFor(
  `[...document.querySelectorAll('button')].some(b => /SCULPT WITH MESHY/.test(b.textContent))`, 30_000))
check('the failed sculpt was refunded', (await balance()) === 30, `balance ${await balance()}`)
const ledger = await ev(`JSON.parse(localStorage.getItem('poplur.credits.ledger.v1') || '[]').map(e => e.kind + ':' + e.delta).join(' ')`)
check('ledger reads welcome → spend → refund', /welcome:30.*avatar-cube:-25.*refund:25/.test(ledger ?? ''), ledger)
check('an error is shown for the failure', await ev(
  `[...document.querySelectorAll('p')].some(p => /not reachable|could not|refused|Lost the job|took too long|Failed to fetch/i.test(p.textContent))`))

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
