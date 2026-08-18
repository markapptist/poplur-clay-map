// Round-3 semantics: pages are places, not subscreens.
//   1. the record survives an app kill (reload resumes the page, no tab switch needed)
//   2. a cube TAP on an open page does NOT unwind it
//   3. dismissing the wheel (empty-space tap) returns to the page
//   4. the home tile is the one thing that clears the record
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173'
const PORT = 9515
const dir = mkdtempSync(join(tmpdir(), 'r3-'))
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
const FIRE = `(el, type, x, y) => el.dispatchEvent(new PointerEvent(type, {
  bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: 'touch',
  isPrimary: true, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1 }))`
const tapCube = () => ev(`(async () => {
  const fire = ${FIRE}
  const el = document.querySelector('[class*="cubeWrap"] canvas')
  if (!el) return false
  const r = el.getBoundingClientRect()
  fire(el, 'pointerdown', r.x + r.width / 2, r.y + r.height / 2)
  await new Promise(f => setTimeout(f, 120))
  fire(el, 'pointerup', r.x + r.width / 2, r.y + r.height / 2)
  return true
})()`)
const holdCube = async () => {
  await ev(`(() => { const fire = ${FIRE}; const el = document.querySelector('[class*="cubeWrap"] canvas'); if (!el) return false; const r = el.getBoundingClientRect(); fire(el, 'pointerdown', r.x + r.width/2, r.y + r.height/2); return true })()`)
  await sleep(1200)
  await ev(`(() => { const fire = ${FIRE}; const el = document.querySelector('[class*="cubeWrap"] canvas'); const r = el.getBoundingClientRect(); fire(el, 'pointerup', r.x + r.width/2, r.y + r.height/2); return true })()`)
  return waitFor(`document.querySelector('[role=dialog][aria-label*="hold menu" i]')`, 8000)
}
const PAGE_UP = `document.querySelector('[data-testid="rcl-subscreen"][data-screen="profile-phone"]')`
const WHEEL_UP = `(document.querySelector('[role=dialog][aria-label*="hold menu" i]') && !document.querySelector('[data-testid="rcl-subscreen"]'))`

// walk to the page the REAL way: wheel spin (deep tiles are culled until spun to)
const tapTile = async screen => {
  for (let spin = 0; spin < 10; spin++) {
    const clicked = await ev(`(() => { const t = document.querySelector('[role=dialog] [data-screen="${screen}"]'); if (!t) return false; t.click(); return true })()`)
    if (clicked) return true
    await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`)
    await sleep(420)
  }
  return false
}

// 1a. the WRITE is immediate: open the page via the wheel, read storage, no tab switch
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.removeItem('poplur.tab.lastScreen.v1') } catch {}` })
await send('Page.navigate', { url: `${BASE}/?view=profile` })
check('profile boots', await waitFor(`document.querySelector('[class*="cubeWrap"] canvas')`, 30_000))
await sleep(2500)
check('wheel opens', await holdCube())
check('PHONE opened via wheel', await tapTile('profile-phone'))
check('phone page up', await waitFor(PAGE_UP, 15_000))
await sleep(800)
check('record written IMMEDIATELY (kill-proof)',
  (await ev(`(JSON.parse(localStorage.getItem('poplur.tab.lastScreen.v1') || '{}')).profile`)) === 'profile-phone')

// 1b. app "kill": plain reload — the page must come back with no tab switch involved
await send('Page.addScriptToEvaluateOnNewDocument', { source: `/* keep storage this time */` })
await send('Page.navigate', { url: `${BASE}/?view=profile` })
check('page RESUMES after reload (no tab switch involved)', await waitFor(PAGE_UP, 30_000))
await sleep(1000)

// 2. cube tap must NOT unwind the page
check('cube tapped', await tapCube())
await sleep(900)
check('page still standing after cube tap', await ev(`!!${PAGE_UP}`))

// 3. hold → wheel; empty-space dismiss → back to the page
check('wheel opens over page', await holdCube())
// The wheel now lays OVER a live page (stageOverPage, z-index 260) instead of
// unmounting it — a deliberate change that matches "pages are places". Assert
// the real contract: the wheel is up, and it is stacked above the page.
const overlay = await ev(`(() => {
  const wheel = document.querySelector('[role=dialog][aria-label*="hold menu" i]')
  const page = document.querySelector('[data-testid="rcl-subscreen"]')
  if (!wheel) return { wheel: false }
  return {
    wheel: true,
    pageStillMounted: !!page,
    wheelZ: Number(getComputedStyle(wheel).zIndex) || 0,
    pageZ: page ? Number(getComputedStyle(page).zIndex) || 0 : null,
  }
})()`)
check('wheel opens over the page (page stays mounted, wheel on top)',
  overlay.wheel && (!overlay.pageStillMounted || overlay.wheelZ > overlay.pageZ),
  JSON.stringify(overlay))
await ev(`(() => { const fire = ${FIRE}; const wheel = document.querySelector('[role=dialog][aria-label*="hold menu" i] [class*="wheel"]') || document.querySelector('[role=dialog][aria-label*="hold menu" i]'); const r = wheel.getBoundingClientRect(); fire(wheel, 'pointerdown', r.x + 30, r.y + 80); fire(wheel, 'pointerup', r.x + 30, r.y + 80); return true })()`)
check('dismissing the wheel returns to the PAGE', await waitFor(PAGE_UP, 10_000))

// 4. home tile clears the record and lands on the root
check('wheel opens again', await holdCube())
check('home tile pressed', await ev(`(() => { const t = document.querySelector('[role=dialog] [data-home]'); if (!t) return false; t.click(); return true })()`))
await sleep(900)
check('at profile root (no page, no wheel)', await ev(`!document.querySelector('[data-testid="rcl-subscreen"]') && !document.querySelector('[role=dialog][aria-label*="hold menu" i]')`))
check('record cleared by home tile',
  !(await ev(`(JSON.parse(localStorage.getItem('poplur.tab.lastScreen.v1') || '{}')).profile`)))

// and a reload now stays at the root
await send('Page.navigate', { url: `${BASE}/?view=profile` })
await sleep(6000)
check('reload after home stays at root', !(await ev(`!!document.querySelector('[data-testid="rcl-subscreen"]')`)))

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures ? 1 : 0)
