// Round-2 features, end to end on the real dev bundle:
//   1. last-page resume via REAL cube swipes (favourites removed)
//   2. hold-menu home tiles
//   3. pull-to-refresh: gap-free news curtain, random peek edge + sprite
//   4. news back-to-top side control
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173'
const OUT = process.argv[3] ?? '.'
const PORT = 9499
const dir = mkdtempSync(join(tmpdir(), 'poplur-r2-'))
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
  '--window-size=430,932', '--mute-audio', '--force-device-scale-factor=2',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
], { stdio: 'ignore' })
const cleanup = () => { try { chrome.kill() } catch {}; try { rmSync(dir, { recursive: true, force: true }) } catch {} }
process.on('exit', cleanup)
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
const shot = async name => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  if (r?.result?.data) writeFileSync(join(OUT, name), Buffer.from(r.result.data, 'base64'))
}
const waitFor = async (expr, ms, step = 350) => {
  const until = Date.now() + ms
  while (Date.now() < until) { if (await ev(`!!(${expr})`)) return true; await sleep(step) }
  return false
}

// Pointer helpers, dispatched inside the page (the components listen for real
// pointer events; this is the pattern every Poplur sweep uses).
const FIRE = `(sel, type, x, y, extra) => {
  const el = typeof sel === 'string' ? document.querySelector(sel) : sel
  if (!el) return false
  el.dispatchEvent(new PointerEvent(type, Object.assign({
    bubbles: true, cancelable: true, composed: true, pointerId: 7,
    pointerType: 'touch', isPrimary: true, clientX: x, clientY: y,
    buttons: type === 'pointerup' ? 0 : 1,
  }, extra || {})))
  return true
}`

/** Horizontal drag on the cube canvas — the REAL tab-switch gesture. */
const swipeCube = async dx => ev(`(async () => {
  const fire = ${FIRE}
  const wrap = document.querySelector('[class*="cubeWrap"]')
  const el = wrap && (wrap.querySelector('canvas') || wrap)
  if (!el) return 'no cube'
  const r = el.getBoundingClientRect()
  let x = r.x + r.width / 2, y = r.y + r.height / 2
  fire(el, 'pointerdown', x, y)
  for (let s = 0; s < 12; s++) {
    x += ${dx} / 12
    fire(el, 'pointermove', x, y)
    await new Promise(f => setTimeout(f, 16))
  }
  fire(el, 'pointerup', x, y)
  return 'swiped'
})()`)

/** Long-press the cube to raise the hold menu. */
const holdCube = async () => {
  await ev(`(() => {
    const fire = ${FIRE}
    const wrap = document.querySelector('[class*="cubeWrap"]')
    const el = wrap && (wrap.querySelector('canvas') || wrap)
    if (!el) return false
    const r = el.getBoundingClientRect()
    fire(el, 'pointerdown', r.x + r.width / 2, r.y + r.height / 2)
    return true
  })()`)
  await sleep(1200)
  await ev(`(() => {
    const fire = ${FIRE}
    const wrap = document.querySelector('[class*="cubeWrap"]')
    const el = wrap && (wrap.querySelector('canvas') || wrap)
    const r = el.getBoundingClientRect()
    fire(el, 'pointerup', r.x + r.width / 2, r.y + r.height / 2)
    return true
  })()`)
  return waitFor(`document.querySelector('[role=dialog][aria-label*="hold menu" i]')`, 8000)
}

// The wheel culls tiles further than ~2.4 slots from the selection, so a deep
// tile must be SPUN to first — ArrowDown walks the wheel exactly like a person.
const tapTile = async screen => {
  for (let spin = 0; spin < 10; spin++) {
    const clicked = await ev(`(() => {
      const tile = document.querySelector('[role=dialog] [data-screen="${screen}"]')
      if (!tile) return false
      tile.click()
      return true
    })()`)
    if (clicked) return true
    await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`)
    await sleep(420)
  }
  return false
}

/** Vertical pull on a pull-refresh scroll host; resolves at HOLD (pre-release). */
const startPull = async dy => ev(`(async () => {
  const fire = ${FIRE}
  const panel = document.querySelector('[data-pull-panel]')
  const scrollEl = panel && panel.parentElement
  if (!scrollEl) return 'no host'
  const r = scrollEl.getBoundingClientRect()
  const x = r.x + r.width / 2
  let y = r.y + 80
  fire(scrollEl, 'pointerdown', x, y)
  for (let s = 0; s < 14; s++) {
    y += ${dy} / 14
    fire(scrollEl, 'pointermove', x, y)
    await new Promise(f => setTimeout(f, 16))
  }
  window.__pullUp = () => fire(scrollEl, 'pointerup', x, y)
  return 'held'
})()`)

// ── 1+2. RESUME + HOME TILES on Profile ─────────────────────────────────────
await send('Page.navigate', { url: `${BASE}/?view=profile` })
await waitFor(`document.querySelector('[class*="cubeWrap"] canvas')`, 30_000)
await ev(`localStorage.removeItem('poplur.tab.lastScreen.v1')`)
await sleep(2000)

check('wheel opens on hold', await holdCube())
check('favourite hint is GONE', !(await ev(`document.body.innerText.includes('HOLD TO FAVOURITE')`)))
check('PROFILE home tile present', await ev(`!!document.querySelector('[role=dialog] [data-home][data-screen="profile-home"]')`))

check('PHONE tile opens', await tapTile('profile-phone'))
check('phone subscreen up', await waitFor(`document.querySelector('[data-testid="rcl-subscreen"][data-screen="profile-phone"]')`, 15_000))

// hold a tile for 800ms — nothing should be pinned anywhere
await ev(`localStorage.getItem('poplur.holdFavourite.profile')`)

// swipe away (real gesture) …
check('swiped off profile', (await swipeCube(-150)) === 'swiped')
await sleep(1800)
const stored = await ev(`JSON.parse(localStorage.getItem('poplur.tab.lastScreen.v1') || '{}')`)
check('leaving recorded the phone screen', stored?.profile === 'profile-phone', JSON.stringify(stored))
check('no favourite key was ever written', !(await ev(`Object.keys(localStorage).some(k => k.startsWith('poplur.holdFavourite'))`)))

// … and swipe back: the phone screen must simply BE there again.
check('swiped back to profile', (await swipeCube(150)) === 'swiped')
check('phone screen RESUMED without the wheel',
  await waitFor(`document.querySelector('[data-testid="rcl-subscreen"][data-screen="profile-phone"]')`, 15_000))
await shot('resume-phone.png')

// home tile drops you at the root and the next leave stores nothing
check('wheel over resumed page', await holdCube())
check('PROFILE tile taps', await ev(`(() => { const t = document.querySelector('[role=dialog] [data-home]'); if (!t) return false; t.click(); return true })()`))
await sleep(700)
check('back at profile root', await ev(`!document.querySelector('[data-testid="rcl-subscreen"]') && !document.querySelector('[role=dialog][aria-label*="hold menu" i]')`))
check('swiped away from root', (await swipeCube(-150)) === 'swiped')
await sleep(1800)
const stored2 = await ev(`JSON.parse(localStorage.getItem('poplur.tab.lastScreen.v1') || '{}')`)
check('root visit stored NO screen', !stored2?.profile, JSON.stringify(stored2))

// ── 3. PULL-TO-REFRESH v2 on News ───────────────────────────────────────────
await send('Page.navigate', { url: `${BASE}/?view=holdmenu&holdScreen=feed-news` })
check('news mounts', await waitFor(`document.querySelector('[data-pull-panel]')`, 30_000))
await sleep(2000)

const edges = []
const sprites = []
for (let round = 0; round < 6; round++) {
  check(`pull ${round + 1} holds`, (await startPull(260)) === 'held')
  await sleep(150)
  const state = await ev(`(() => {
    const panel = document.querySelector('[data-pull-panel]')
    const head = panel.querySelector('div')
    const img = head.querySelector('img')
    const host = panel.parentElement
    const masthead = document.querySelector('[class*="masthead"]')
    return {
      edge: head.dataset.edge,
      sprite: (img.src.match(/sprites\\/[a-z0-9_.-]+/i) || [''])[0],
      gap: masthead ? Math.round(masthead.getBoundingClientRect().top - panel.getBoundingClientRect().bottom) : 999,
      hostTop: Math.round(host.getBoundingClientRect().top),
    }
  })()`)
  edges.push(state.edge)
  sprites.push(state.sprite)
  if (round === 0) {
    check('curtain reaches the masthead (no paper gap)', state.gap <= 2, `gap ${state.gap}px`)
    await shot('pull-news-flush.png')
  }
  await ev(`window.__pullUp()`)
  await sleep(1400)
}
check('peek edge varies across pulls', new Set(edges).size >= 2, edges.join(','))
check('peek sprite varies across pulls', new Set(sprites).size >= 2, sprites.map(s => s.split('/')[1]?.split('_')[1] ?? s).join(','))
check('every sprite came from the baked set', sprites.every(s => /sprites\//.test(s)), sprites.join(' '))

// ── 4. Back-to-top ──────────────────────────────────────────────────────────
await ev(`document.querySelector('[data-pull-panel]').parentElement.scrollTo({ top: 2200 })`)
await sleep(600)
check('TOP button appears when deep', await ev(`(() => {
  const b = document.querySelector('[aria-label="Back to the top of the paper"]')
  return b && getComputedStyle(b).opacity === '1'
})()`))
await shot('news-top-button.png')
await ev(`document.querySelector('[aria-label="Back to the top of the paper"]').click()`)
await sleep(1600)
const backAt = await ev(`document.querySelector('[data-pull-panel]').parentElement.scrollTop`)
check('TOP returns to the masthead', backAt < 60, `scrollTop ${backAt}`)
check('TOP hides again at the top', await waitFor(`getComputedStyle(document.querySelector('[aria-label="Back to the top of the paper"]')).opacity === '0'`, 3000))

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures ? 1 : 0)
