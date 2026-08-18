// The fake TV Guide hunt.
//   A. an unknown embed id renders BLANK (not the catalogue's default screen)
//   B. the channel arrows never step onto a home DOOR (which produced it)
//   C. every real profile embed still renders its own screen
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173'
const TWINS = process.argv[3] ?? 'http://127.0.0.1:8945/.claude/artifacts/poplur-subscreen-twins.html'
const PORT = 9521
const dir = mkdtempSync(join(tmpdir(), 'ftv-'))
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
  '--window-size=430,932', '--mute-audio', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
], { stdio: 'ignore' })
process.on('exit', () => { try { chrome.kill() } catch {}; try { rmSync(dir, { recursive: true, force: true }) } catch {} })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}
let target
for (let i = 0; i < 60 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(t => t.type === 'page') } catch {}
  if (!target) await sleep(500)
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
await new Promise(r => ws.addEventListener('open', r))
const send = (m, p = {}) => new Promise(res => { const i = ++id; pending.set(i, res); setTimeout(() => { pending.delete(i); res({ timedOut: true }) }, 45000); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
const ev = async expression =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))?.result?.result?.value
const waitFor = async (expr, ms, step = 400) => {
  const until = Date.now() + ms
  while (Date.now() < until) { if (await ev(`!!(${expr})`)) return true; await sleep(step) }
  return false
}

// ── A. the twins artifact itself ────────────────────────────────────────────
// The mock TV Guide's own marker text, straight from the catalogue's render.
const TVGUIDE_MARK = `document.body.innerText.toUpperCase().includes('TV GUIDE')`
for (const [label, screen, expectBlank] of [
  ['known id (profile-phone) still renders', 'profile-phone', false],
  ['host door id (profile-home) renders BLANK', 'profile-home', true],
  ['host door id (feed-home) renders BLANK', 'feed-home', true],
  ['host door id (map-home) renders BLANK', 'map-home', true],
  ['unknown junk id renders BLANK', 'not-a-real-screen', true],
]) {
  await send('Page.navigate', { url: `${TWINS}?embed=${screen}&rcl=1` })
  await sleep(1800)
  const body = await ev(`document.getElementById('screen')?.innerHTML.trim().length ?? -1`)
  const showsTv = await ev(TVGUIDE_MARK)
  if (expectBlank) check(label, body === 0 && !showsTv, `screen html ${body} chars, tvguide=${showsTv}`)
  else check(label, body > 0, `${body} chars`)
}

// ── B. the arrow-walk in the real app ───────────────────────────────────────
const FIRE = `(el, type, x, y) => el.dispatchEvent(new PointerEvent(type, {
  bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: 'touch',
  isPrimary: true, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1 }))`
const holdCube = async () => {
  await ev(`(() => { const fire = ${FIRE}; const el = document.querySelector('[class*="cubeWrap"] canvas'); if (!el) return false; const r = el.getBoundingClientRect(); fire(el, 'pointerdown', r.x + r.width/2, r.y + r.height/2); return true })()`)
  await sleep(1200)
  await ev(`(() => { const fire = ${FIRE}; const el = document.querySelector('[class*="cubeWrap"] canvas'); const r = el.getBoundingClientRect(); fire(el, 'pointerup', r.x + r.width/2, r.y + r.height/2); return true })()`)
  return waitFor(`document.querySelector('[role=dialog][aria-label*="hold menu" i]')`, 8000)
}
const tapTile = async screen => {
  for (let spin = 0; spin < 10; spin++) {
    const clicked = await ev(`(() => { const t = document.querySelector('[role=dialog] [data-screen="${screen}"]'); if (!t) return false; t.click(); return true })()`)
    if (clicked) return true
    await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`)
    await sleep(420)
  }
  return false
}

await send('Page.navigate', { url: `${BASE}/?view=profile` })
await waitFor(`document.querySelector('[class*="cubeWrap"] canvas')`, 30_000)
await ev(`localStorage.removeItem('poplur.tab.lastScreen.v1')`)
await sleep(2500)
check('wheel opens', await holdCube())
check('PHONE page opens', await tapTile('profile-phone'))
check('phone page up', await waitFor(`document.querySelector('[data-testid="rcl-subscreen"][data-screen="profile-phone"]')`, 15_000))

// Walk the arrows a full lap; a door must never become the open page.
const seen = []
for (let step = 0; step < 8; step++) {
  await ev(`window.dispatchEvent(new CustomEvent('poplur-channel-step', { detail: { dir: 1 } }))`)
  await ev(`(() => { const fire = ${FIRE}; const up = document.querySelector('[class*="arrowUp"], [class*="chanUp"], [aria-label*="up" i]'); if (up) { const r = up.getBoundingClientRect(); fire(up, 'pointerdown', r.x + r.width/2, r.y + r.height/2); fire(up, 'pointerup', r.x + r.width/2, r.y + r.height/2) } return !!up })()`)
  await sleep(700)
  const at = await ev(`document.querySelector('[data-testid="rcl-subscreen"]')?.dataset.screen ?? document.querySelector('[role=dialog]')?.getAttribute('aria-label') ?? 'none'`)
  seen.push(at)
}
check('arrows never land on a door (-home)', !seen.some(s => String(s).endsWith('-home')), seen.join(' → '))
check('arrows never surfaced a mock TV Guide',
  !(await ev(`(document.querySelector('[data-testid="rcl-subscreen"]')?.dataset.screen === 'feed-tvguide')`)),
  String(seen.at(-1)))

// ── C. every real profile embed renders its own screen ──────────────────────
for (const screen of ['profile-messages', 'profile-store', 'profile-phone', 'profile-stats']) {
  await send('Page.navigate', { url: `${TWINS}?embed=${screen}&rcl=1` })
  // Poll for the render rather than sleeping blind: a fixed wait raced the
  // document parse and reported an unrendered screen as an empty one.
  const CHARS = `document.getElementById('screen')?.innerHTML.trim().length ?? -1`
  await waitFor(`(${CHARS}) > 100`, 15_000, 300)
  const chars = await ev(CHARS)
  const showsTv = await ev(TVGUIDE_MARK)
  check(`${screen} renders its own twin`, chars > 100 && !(screen !== 'feed-tvguide' && showsTv),
    `${chars} chars, tvguide=${showsTv}`)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures ? 1 : 0)
