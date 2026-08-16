// Focused probe for the new AVATAR subscreen. Drives the real dev bundle over
// CDP and PROBES THE DOM rather than screenshotting (screenshots starve under
// load and the silence reads as a hang).
//
//   node probe-avatar.mjs [--base http://127.0.0.1:5173]
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : fallback
}
const BASE = arg('base', 'http://127.0.0.1:5173')
const PORT = Number(arg('port', 9471))
const dir = mkdtempSync(join(tmpdir(), 'poplur-avatar-'))
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
  '--window-size=430,932', '--autoplay-policy=no-user-gesture-required', '--mute-audio',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
], { stdio: 'ignore' })
const cleanup = () => { try { chrome.kill() } catch {} ; try { rmSync(dir, { recursive: true, force: true }) } catch {} }
process.on('exit', cleanup)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup(); process.exit(130) })

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
if (!target) { console.log('FATAL chrome never exposed a page target'); process.exit(1) }

const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const consoleErrors = []
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(m.params?.exceptionDetails?.exception?.description ?? 'exception')
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push(m.params.args.map(a => a.value ?? a.description ?? '').join(' '))
  }
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

await send('Runtime.enable')
await send('Page.enable')

// A 2×2 red PNG standing in for a business logo — the ONLY image this test
// supplies, and the only one the screen is allowed to consume.
const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC'

// Seeded before the app boots so USE MY PROFILE PICTURE has something to use,
// and so the ledger starts clean on every run.
// Seed ONCE per run, not per document: this fires on every navigation, and a
// version that cleared state each time was deleting the worn cube right
// before the reload check that exists to prove it survives a reload.
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
    window.__previewUrls = []
    window.addEventListener('poplur-avatar-preview', e => window.__previewUrls.push(e.detail))
  `,
})

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

// ── 1. the screen opens straight from the URL ───────────────────────────────
await send('Page.navigate', { url: `${BASE}/?view=holdmenu&holdScreen=profile-avatar` })
check('AVATAR subscreen mounts', await waitFor(`document.querySelector('[data-poplur-screen="avatar"]')`, 25_000))
const walletText = await ev(`document.querySelector('[data-poplur-screen="avatar"]')?.innerText.slice(0, 120)`)
check('credit balance shows the welcome grant', /30/.test(walletText ?? ''), JSON.stringify(walletText))

// ── 2. the tile is in the PROFILE wheel ─────────────────────────────────────
const inWheel = await ev(`(() => {
  const source = [...document.querySelectorAll('script')].length
  return true
})()`)
// The wheel itself is only mounted on the profile tab; check the item set the
// same way the app does, by opening the wheel below.

// ── 3. the free bake makes a real cube ──────────────────────────────────────
check('USE MY PROFILE PICTURE is offered', await clickText('USE MY PROFILE PICTURE'))
check('reaches the style step', await waitFor(`[...document.querySelectorAll('button')].some(b => /SCULPT WITH MESHY/.test(b.textContent))`, 8_000))
check('sculpt button is priced in credits',
  await ev(`[...document.querySelectorAll('button')].some(b => /SCULPT WITH MESHY · 25 CREDITS/.test(b.textContent))`))

check('press-it-on is offered', await clickText('PRESS IT ON A CLAY CUBE'))
check('reaches the done step', await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'WEAR IT')`, 30_000))

const saved = await ev(`JSON.parse(localStorage.getItem('poplur.avatar.cubes.v1') || '[]')`)
check('one cube saved to the index', Array.isArray(saved) && saved.length === 1, JSON.stringify(saved?.[0] ?? null))
check('the saved GLB has real weight', (saved?.[0]?.bytes ?? 0) > 5_000, `${saved?.[0]?.bytes} bytes`)
check('it is recorded as a local bake, not a sculpt', saved?.[0]?.source === 'logo')

const blobBytes = await ev(`(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('poplur-avatar-cubes', 1)
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
  })
  const id = JSON.parse(localStorage.getItem('poplur.avatar.cubes.v1'))[0].id
  const blob = await new Promise((res, rej) => {
    const r = db.transaction('cubes').objectStore('cubes').get(id)
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
  })
  if (!blob) return 0
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer())
  return String.fromCharCode(...head) === 'glTF' ? blob.size : -1
})()`)
check('the blob in IndexedDB is a real GLB', blobBytes > 5_000, `${blobBytes} bytes, glTF magic ok`)

// ── 4. the navigator is holding it ──────────────────────────────────────────
check('the cube was handed to the navigator',
  (await ev(`window.__previewUrls.filter(Boolean).length`)) >= 1)
check('the navigator loaded the baked cube (not a stand-in)',
  await waitFor(`(() => {
    const model = window.__poplurCubeModel
    if (!model) return false
    let hit = false
    model.traverse(n => { if (n.name === 'PoplurAvatarCube') hit = true })
    return hit
  })()`, 20_000),
  await ev(`window.__poplurCubeModel ? window.__poplurCubeModel.children.map(c => c.name).join(',') : 'no model'`))

// ── 5. wearing it persists ──────────────────────────────────────────────────
check('WEAR IT accepted', await clickText('WEAR IT'))
await sleep(600)
check('worn cube is persisted',
  (await ev(`localStorage.getItem('poplur.avatar.worn.v1')`)) === saved?.[0]?.id)
check('credits untouched by the free path',
  (await ev(`JSON.parse(localStorage.getItem('poplur.credits.ledger.v1') || '[]')
    .reduce((t, e) => t + e.delta, 0)`)) === 30)

// ── 6. the tile is really in the profile hold menu ──────────────────────────
await send('Page.navigate', { url: `${BASE}/?view=profile` })
await waitFor(`document.querySelector('[class*=cubeWrap]')`, 25_000)
const HOLD = `(() => {
  const wrap = document.querySelector('[class*=cubeWrap]')
  if (!wrap) return false
  const el = wrap.querySelector('canvas') || wrap
  const r = el.getBoundingClientRect()
  const base = { bubbles:true, cancelable:true, composed:true, pointerId:1, pointerType:'touch',
                 isPrimary:true, clientX: r.x + r.width/2, clientY: r.y + r.height/2, button:0 }
  el.dispatchEvent(new PointerEvent('pointerdown', {...base, buttons:1}))
  window.__rel = () => el.dispatchEvent(new PointerEvent('pointerup', {...base, buttons:0}))
  return true
})()`
await ev(HOLD)
await sleep(1200)
await ev('window.__rel && window.__rel()')
check('profile hold menu opens', await waitFor(`document.querySelector('[role=dialog][aria-label*="hold menu" i]')`, 10_000))
const tiles = await ev(`[...document.querySelectorAll('[role=dialog] [data-screen]')].map(b => b.dataset.screen)`)
check('AVATAR tile is in the profile wheel', (tiles ?? []).includes('profile-avatar'), JSON.stringify(tiles))

// ── 7. and the worn cube is what Profile holds ──────────────────────────────
await send('Page.navigate', { url: `${BASE}/?view=profile` })
check('Profile wears the custom cube after a reload',
  await waitFor(`(() => {
    const model = window.__poplurCubeModel
    if (!model) return false
    let hit = false
    model.traverse(n => { if (n.name === 'PoplurAvatarCube') hit = true })
    return hit
  })()`, 30_000))

const realErrors = consoleErrors.filter(text =>
  !/favicon|mapbox|Failed to load resource.*(models|sprites)|geolocation|AudioContext/i.test(text))
check('no console errors', realErrors.length === 0, realErrors.slice(0, 4).join(' | '))

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
