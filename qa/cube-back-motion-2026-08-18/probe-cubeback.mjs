// The cube is the back button: the Times' story page, Settings' sub-pages and
// Avatar's stages all lost their "‹ BACK" and hand the step up to the cube.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const BASE = process.argv[2] ?? 'http://127.0.0.1:5173'
const OUT = process.argv[3]
const PORT = 9561
const dir = mkdtempSync(join(tmpdir(), 'cb-'))
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
const waitFor = async (e, ms, s = 300) => { const u = Date.now() + ms; while (Date.now() < u) { if (await ev(`!!(${e})`)) return true; await sleep(s) } return false }
const gone = async (e, ms, s = 300) => { const u = Date.now() + ms; while (Date.now() < u) { if (!(await ev(`!!(${e})`))) return true; await sleep(s) } return false }
const shot = async n => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r?.result?.data && OUT) writeFileSync(join(OUT, n), Buffer.from(r.result.data, 'base64')) }
// Cold module compilation puts the paper ~18s out, and this checkout is edited
// live (vite restarts mid-run). Navigate, and if nothing is up by the budget,
// navigate AGAIN before giving up — otherwise a restart window reads as a
// broken screen and every negative check below passes vacuously.
const openScreen = async (screen, ready, budget = 45_000) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    await send('Page.navigate', { url: `${BASE}/?view=holdmenu&holdScreen=${screen}` })
    if (await waitFor(ready, budget)) return true
    console.log(`      (retrying ${screen} — nothing up after ${budget / 1000}s)`)
  }
  return false
}

// A real tap on the navigator: pointerdown/up inside CubeTab3D's 350ms window.
const tapCube = () => ev(`(async () => {
  const c = document.querySelector('canvas[role="button"][aria-roledescription="tab navigator"]')
  if (!c) return false
  const r = c.getBoundingClientRect(); const x = r.x + r.width/2, y = r.y + r.height/2
  const fire = (ty, buttons) => c.dispatchEvent(new PointerEvent(ty, {
    bubbles: true, cancelable: true, composed: true, pointerId: 3, pointerType: 'touch',
    isPrimary: true, clientX: x, clientY: y, buttons,
  }))
  fire('pointerdown', 1); await new Promise(f => setTimeout(f, 90)); fire('pointerup', 0)
  return true })()`)

const anyBackButton = `[...document.querySelectorAll('button')].some(b => /^\\s*‹?\\s*BACK\\s*$/i.test(b.textContent || ''))`

// ── The Times: a story page ────────────────────────────────────────────────
check('the paper mounts', await openScreen('feed-news', `document.querySelector('[data-pull-panel]')`))
await sleep(2500)
check('the navigator is on screen with the paper', await ev(`!!document.querySelector('canvas[aria-roledescription="tab navigator"]')`))

await ev(`document.querySelector('[class*="timeline"] article').click()`)
check('a post opens a story page', await waitFor(`document.querySelector('[class*="detail"][role=dialog]')`, 6000))
check('the story carries NO "‹ BACK" of its own', !(await ev(anyBackButton)))
await shot('news-story-no-back.png')

await tapCube()
check('the cube takes the story back to the edition',
  await gone(`document.querySelector('[class*="detail"][role=dialog]')`, 4000))
check('…and leaves you ON the paper, not out of it',
  await ev(`!!document.querySelector('[data-pull-panel]')`))
await shot('news-back-on-edition.png')

// The drawer is the layer above the story — innermost first.
const burger = await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => /menu|search/i.test(x.getAttribute('aria-label')||''))
  if (!b) return null; b.click(); return b.getAttribute('aria-label') })()`)
if (burger) {
  check('the drawer opens', await waitFor(`document.querySelector('[class*="drawer"]')`, 4000), burger)
  await tapCube()
  check('the cube closes the drawer first', await gone(`document.querySelector('[class*="scrim"]')`, 4000))
} else {
  console.log('SKIP  drawer — no burger control found by label')
}

// ── Settings: a sub-page ───────────────────────────────────────────────────
check('settings mounts', await openScreen('profile-settings',
  `[...document.querySelectorAll('button')].some(b => /App Icon/i.test(b.textContent||''))`))
await sleep(1800)
await ev(`[...document.querySelectorAll('button')].find(b => /App Icon/i.test(b.textContent||'')).click()`)
check('a settings sub-page opens', await waitFor(`document.querySelector('[class*="navBar"]')`, 5000))
check('the sub-page carries NO "‹ SETTINGS" button',
  !(await ev(`[...document.querySelectorAll('button')].some(b => /‹\\s*SETTINGS/i.test(b.textContent||''))`)))
await shot('settings-subpage-no-back.png')
await tapCube()
check('the cube walks the sub-page back to the list',
  await gone(`document.querySelector('[class*="navBar"]')`, 4000))
check('…and settings is still open', await ev(`[...document.querySelectorAll('button')].some(b => /App Icon/i.test(b.textContent||''))`))
await shot('settings-back-on-list.png')

// ── Avatar: the stages ─────────────────────────────────────────────────────
// Reaching 'style' needs a real image, so hand the file input one through CDP
// rather than trying to click through a native picker.
const png = join(tmpdir(), 'poplur-probe-avatar.png')
writeFileSync(png, Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'))
check('avatar mounts', await openScreen('profile-avatar',
  `document.querySelector('input[type=file][accept^="image"]')`))
await sleep(1500)
await send('DOM.getDocument', { depth: -1 })
const root = (await send('DOM.getDocument'))?.result?.root?.nodeId
const inputNode = (await send('DOM.querySelector', { nodeId: root, selector: 'input[type=file][accept^="image"]' }))?.result?.nodeId
await send('DOM.setFileInputFiles', { nodeId: inputNode, files: [png] })
check('a picture takes avatar off the shelf and into its stages',
  await waitFor(`[...document.querySelectorAll('button')].some(b => /PRESS IT ON A CLAY CUBE/i.test(b.textContent||''))`, 8000))
check('that stage carries NO "‹ BACK" of its own', !(await ev(anyBackButton)))
await shot('avatar-stage-no-back.png')
await tapCube()
check('the cube walks the stage back to the shelf',
  await gone(`[...document.querySelectorAll('button')].some(b => /PRESS IT ON A CLAY CUBE/i.test(b.textContent||''))`, 5000))
check('…and avatar is still open', await ev(`!!document.querySelector('input[type=file][accept^="image"]')`))

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
