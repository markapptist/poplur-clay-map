// Does device tilt actually move the objects, and does the camcorder AIM?
// Reads the real scene graph: __poplurCubeModel.parent is the yaw group,
// its parent is the pitch group (scene -> pitchGroup -> group -> model).
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const BASE = process.argv[2] ?? 'http://127.0.0.1:5173'
const PORT = 9563
const dir = mkdtempSync(join(tmpdir(), 'cm-'))
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
  '--window-size=430,932', '--mute-audio',
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
await send('Page.enable')
const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.result?.value
const waitFor = async (e, ms, s = 300) => { const u = Date.now() + ms; while (Date.now() < u) { if (await ev(`!!(${e})`)) return true; await sleep(s) } return false }
const deg = r => (r * 180 / Math.PI)

/** Hold the handset at a fixed attitude until the spring settles, then read
    the object's real rotation off the scene graph. */
const tiltAndRead = async (gamma, beta) => {
  await ev(`(async () => {
    for (let i = 0; i < 55; i++) {
      window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', {
        alpha: 0, beta: ${beta}, gamma: ${gamma}, absolute: true }))
      await new Promise(f => setTimeout(f, 40))
    }
    return true })()`)
  await sleep(1200)
  return ev(`(() => {
    const m = window.__poplurCubeModel
    if (!m || !m.parent || !m.parent.parent) return null
    return { yaw: m.parent.rotation.y, pitch: m.parent.parent.rotation.x } })()`)
}

const open = async (query, budget = 50_000) => {
  for (let a = 0; a < 3; a++) {
    await send('Page.navigate', { url: `${BASE}/${query}` })
    if (await waitFor(`window.__poplurCubeModel`, budget)) { await sleep(2500); return true }
    console.log(`      (retrying ${query} — no navigator object after ${budget / 1000}s)`)
  }
  return false
}
/** Which object is actually on the navigator. fitIntoGroup stamps the model's
    own rotation from MODEL_ORIENTATION, and the camcorder's is the only y of
    -pi/2 — so this distinguishes "measured the camcorder" from "measured
    whatever the route fell back to", which is how this probe first reported
    the camcorder as behaving exactly like the cube. */
const onNavigator = () => ev(`(() => {
  const m = window.__poplurCubeModel
  if (!m) return 'none'
  return Math.abs(m.rotation.y + Math.PI / 2) < 0.01 ? 'camcorder' : 'other' })()`)

// ── The clay cube: it PARALLAXES (opposes the tilt), through a real envelope ──
check('the feed cube is on the navigator', await open('?view=feed'))
check('…and it is NOT the camcorder', (await onNavigator()) === 'other')
const cube = await tiltAndRead(30, 80)
check('a 30° roll actually moves the cube', cube && Math.abs(cube.yaw) > 0.01,
  cube ? `yaw ${deg(cube.yaw).toFixed(1)}°  pitch ${deg(cube.pitch).toFixed(1)}°` : 'no reading')
check('the cube OPPOSES the roll (clay behind glass)', cube && cube.yaw < 0)
check('…and reaches the widened 16° envelope, not the old 8°',
  cube && Math.abs(deg(cube.yaw)) > 12, cube ? `${Math.abs(deg(cube.yaw)).toFixed(1)}° of 16°` : '')

// ── The camcorder: it AIMS (follows), through its own much wider envelope ─────
// ?view=camera is the camera tab (ViewHarness's ROUTES; 'post' is the internal
// CubeTab name and is NOT a route — it silently falls back to the feed, which
// is exactly how this probe first "measured" the camcorder and got the cube).
check('the camcorder is on the navigator', await open('?view=camera&camera-mode=video'))
const which = await onNavigator()
check('…and the object really IS the camcorder', which === 'camcorder', which)
const cam = await tiltAndRead(30, 80)
check('the camcorder answers the same tilt', cam && Math.abs(cam.yaw) > 0.01,
  cam ? `yaw ${deg(cam.yaw).toFixed(1)}°  pitch ${deg(cam.pitch).toFixed(1)}°` : 'no reading')
check('the camcorder FOLLOWS the roll — it points where you point', cam && cam.yaw > 0)
check('…and its pitch tracks the hold angle instead of folding back',
  cam && cam.pitch > 0.05, cam ? `${deg(cam.pitch).toFixed(1)}° at an 80° hold` : '')
check('the camcorder envelope is genuinely wider than the cube\'s (was DEAD code)',
  cam && cube && Math.abs(cam.yaw) > Math.abs(cube.yaw) * 1.4,
  cam && cube ? `${Math.abs(deg(cam.yaw)).toFixed(1)}° vs ${Math.abs(deg(cube.yaw)).toFixed(1)}°` : '')
check('…and it is well past the 8° ceiling that used to clamp it',
  cam && Math.abs(deg(cam.yaw)) > 20, cam ? `${Math.abs(deg(cam.yaw)).toFixed(1)}°` : '')

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
