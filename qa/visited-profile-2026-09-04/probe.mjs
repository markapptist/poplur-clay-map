#!/usr/bin/env node
// Headless proof of the radius high striker, the Poplur pop dialog and the
// map→feed handoff, driven in the REAL nested shell (5173 ?view=map) — never
// the standalone map, where window.parent === window hides every shell-side
// failure. Polls the DOM rather than screenshotting (CDP screenshots starve
// under load; see headless_probe_over_screenshot), and takes ONE screenshot
// per milestone at the end of each step as proof.
//
//   node qa/radius-striker-2026-09-03/probe.mjs [origin] [--out DIR]
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const args = process.argv.slice(2)
const ORIGIN = args.find(a => !a.startsWith('--')) ?? 'http://127.0.0.1:5173'
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(process.cwd(), 'qa/radius-striker-2026-09-03/out')
const PORT = 9611 + (process.pid % 150)
mkdirSync(OUT, { recursive: true })

const profileDir = mkdtempSync(join(tmpdir(), 'poplur-striker-'))
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`,
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--enable-gpu-rasterization',
  '--window-size=393,852', 'about:blank',
], { stdio: 'ignore' })
const cleanup = () => { try { chrome.kill() } catch {} try { rmSync(profileDir, { recursive: true, force: true }) } catch {} }
process.on('exit', cleanup)
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function target() {
  for (let i = 0; i < 100; i++) {
    try {
      const t = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const p = t.find(x => x.type === 'page')
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl
    } catch {}
    await sleep(150)
  }
  throw new Error('Chrome DevTools endpoint never came up')
}
function connect(ws) {
  const s = new WebSocket(ws); let id = 1; const pend = new Map()
  s.addEventListener('message', e => {
    const m = JSON.parse(e.data)
    if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result) }
  })
  return {
    ready: new Promise((res, rej) => { s.addEventListener('open', res); s.addEventListener('error', rej) }),
    send: (method, params = {}) => new Promise((res, rej) => { const i = id++; pend.set(i, { res, rej }); s.send(JSON.stringify({ id: i, method, params })) }),
  }
}
const cdp = connect(await target())
await cdp.ready
await cdp.send('Page.enable')
await cdp.send('Runtime.enable')
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 2, mobile: true })
// A viewer fix the Map can find on its own, so the map→shell location bridge
// has something to carry. Downtown Toronto, a block from the preview origin.
await cdp.send('Browser.grantPermissions', { origin: ORIGIN, permissions: ['geolocation'] })
await cdp.send('Emulation.setGeolocationOverride', { latitude: 43.6512, longitude: -79.3832, accuracy: 20 })

const ev = async (expression) => {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
  return result.value
}
const shot = async (name) => {
  try {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(OUT, name), Buffer.from(data, 'base64'))
    console.log(`  📸 ${name}`)
  } catch (error) { console.log(`  (screenshot ${name} skipped: ${error.message})`) }
}
const until = async (label, expression, ms = 60_000, every = 400) => {
  const started = Date.now()
  for (;;) {
    let value = null
    try { value = await ev(expression) } catch {}
    if (value) return value
    if (Date.now() - started > ms) throw new Error(`timed out waiting for ${label}`)
    await sleep(every)
  }
}
const FRAME = `document.querySelector('iframe[title="Poplur clay map"]')`
const IN = (js) => `(() => { const f = ${FRAME}; const w = f && f.contentWindow; const d = f && f.contentDocument; if (!w || !d) return null; return (${js})(w, d) })()`

const verdicts = []
const verdict = (name, ok, detail) => { verdicts.push({ name, ok, detail }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`) }

console.log(`▶ ${ORIGIN}/?view=map`)
await cdp.send('Page.navigate', { url: `${ORIGIN}/?view=map` })
await until('the map frame', `Boolean(${FRAME})`, 90_000)
await until('the map to load', IN(`(w) => Boolean(w.__map && w.__map.loaded && w.__map.loaded())`), 120_000, 800)
await until('the zoom rail', IN(`(w, d) => Boolean(d.querySelector('[data-zoom-thumb]'))`), 60_000)
await sleep(4000)

// ── Somebody else's profile: Block/Report above Message, a real picture or
// "no photo set", and the way back out ──
await ev(`(() => { const p = [...document.querySelectorAll('p')].find(x => /tap anywhere to start/i.test(x.textContent)); if (p) (p.closest('[role]') || p.parentElement).click(); return 1 })()`)
await sleep(800)
// Prefer a pin standing on this ground (the cohort's), then any stranger's;
// markers come and go with the camera, so every step re-reads the board.
const PIN = `(w, d) => { const roots = [...d.querySelectorAll('[data-map-point-kind="pin"][data-domination-owner]')].filter(r => r.querySelector('button')); const r = roots.find(x => /radius-lab-cohort/.test(x.dataset.mapPointId || '')) || roots[0]; return r ? { id: r.dataset.mapPointId, owner: r.dataset.dominationOwner, label: r.querySelector('button').getAttribute('aria-label') } : null }`
let pin = null
try {
  pin = await until('a stranger\'s pin', IN(PIN), 150_000, 1500)
} catch (error) {
  const census = await ev(IN(`(w, d) => ({ kinds: d.querySelectorAll('[data-map-point-kind]').length, owners: d.querySelectorAll('[data-domination-owner]').length, pins: d.querySelectorAll('[data-map-point-kind="pin"]').length, markers: d.querySelectorAll('.mapboxgl-marker').length, zoom: w.__map ? w.__map.getZoom().toFixed(2) : null })`))
  console.log('  board census at timeout:', JSON.stringify(census))
  throw error
}
console.log(`  opening ${pin.id} (${pin.label})`)
const openProfileFromPin = async (pinId) => {
  const clicked = await ev(IN(`(w, d) => { const all = [...d.querySelectorAll('[data-map-point-kind="pin"][data-domination-owner]')].filter(r => r.querySelector('button')); const r = all.find(x => x.dataset.mapPointId === ${JSON.stringify(pinId)}) || all[0]; if (!r) return null; r.querySelector('button').click(); return r.dataset.mapPointId }`))
  if (!clicked) throw new Error('no stranger pin mounted to open')
  console.log(`  tapped ${clicked}`)
  await until('the pop dialog', IN(`(w, d) => Boolean(d.querySelector('[data-poplur-dialog] h2'))`), 20_000)
  // The pop dialog's profile button was cut on request (it offers See in
  // Feed and Message now), so the profile is reached the way the map's own
  // code still can: the poplur-map-open-profile message, posted FROM the map
  // frame so the shell's source check accepts it.
  const who = await ev(IN(`(w, d) => { const h = d.querySelector('[data-poplur-dialog] h2'); const user = h ? h.textContent.trim() : null; const x = d.querySelector('[data-poplur-dialog] button[aria-label="Close"]'); if (x) x.click(); return user }`))
  const marker = await ev(IN(`(w, d) => { const r = [...d.querySelectorAll('[data-map-point-kind="pin"][data-domination-owner]')].find(x => x.dataset.mapPointId === ${JSON.stringify(clicked)}); return r ? { owner: r.dataset.dominationOwner, name: (r.querySelector('button')?.getAttribute('aria-label') || '').split(' holds ')[1]?.split(',')[0] || '' } : null }`))
  await sleep(400)
  await ev(`(() => { const f = document.querySelector('iframe[title="Poplur clay map"]'); f.contentWindow.eval(${JSON.stringify(`window.parent.postMessage({ type: 'poplur-map-open-profile', user: USER, userId: OWNER, popId: POP, name: NAME }, '*')`)}.replace('USER', JSON.stringify(${JSON.stringify(who)})).replace('OWNER', JSON.stringify(${JSON.stringify(marker?.owner ?? '')})).replace('POP', JSON.stringify(${JSON.stringify(clicked)})).replace('NAME', JSON.stringify(${JSON.stringify(marker?.name ?? '')}))); return 1 })()`)
  console.log(`  asked the shell to open ${who}'s profile (${marker?.owner})`)
  await until('the visited profile', `Boolean(document.querySelector('[data-poplur-screen="profile"] [data-profile-safety-dialog], [data-poplur-screen="profile"] button[aria-label^="Block or report"]'))`, 30_000)
  await sleep(1200)
  // The profile's first-run coach card sits over the grid; clear it so the
  // screenshots show the screen, not the lesson.
  await ev(`(() => { const p = [...document.querySelectorAll('p')].find(x => /tap anywhere to start/i.test(x.textContent)); if (p) (p.closest('[role]') || p.parentElement).click(); return 1 })()`)
  await sleep(600)
}
await openProfileFromPin(pin.id)
// The tab push remounts the surface for a beat; read the rail only once the
// settled profile is standing with its Block control on it.
const rail = await until('the settled visited profile', `(() => { const p = document.querySelector('[data-poplur-screen="profile"]'); if (!p || !p.querySelector('button[aria-label^="Block or report"]')) return null; const btns = [...p.querySelectorAll('[role="toolbar"][aria-label="Profile controls"] button')].map(b => b.getAttribute('aria-label')); const msg = p.querySelector('button[aria-label^="Message"] img[data-poplur-side-icon]'); return { btns, messageIcon: msg ? msg.dataset.poplurSideIcon : null, noPhoto: Boolean(p.querySelector('[data-profile-no-photo]')), photo: (p.querySelector('.avatarWrap img, [class*="avatarWrap"] img') || {}).src || null } })()`, 30_000, 600)
const blockIdx = rail.btns.findIndex(b => /^Block or report/.test(b || ''))
const msgIdx = rail.btns.findIndex(b => /^Message /.test(b || ''))
verdict('Block sits above Message on the visited rail', blockIdx >= 0 && msgIdx >= 0 && blockIdx < msgIdx, JSON.stringify(rail.btns))
verdict('Message wears the rail\'s mail icon (feed.dm)', rail.messageIcon === 'feed.dm', `icon ${rail.messageIcon}`)
verdict('the picture is real or honestly absent — never a stand-in head', rail.noPhoto || /^https:\/\//.test(rail.photo || ''), `noPhoto=${rail.noPhoto} photo=${rail.photo}`)
await shot('1-visited-profile.png')
await ev(`document.querySelector('[data-poplur-screen="profile"] button[aria-label^="Block or report"]').click()`)
const dialog = await until('the Block/Report dialog', `(() => { const d = document.querySelector('[data-profile-safety-dialog] [role="dialog"]'); if (!d) return null; return { title: d.querySelector('h2')?.textContent.trim(), buttons: [...d.querySelectorAll('button')].map(b => b.textContent.trim()) } })()`, 15_000)
verdict('the Poplur dialog offers Block and Report', /^Block /.test(dialog.title || '') && dialog.buttons.some(b => /^Block /.test(b)) && dialog.buttons.some(b => /^Report /.test(b)), JSON.stringify(dialog))
await shot('2-block-report-dialog.png')
await ev(`[...document.querySelectorAll('[data-profile-safety-dialog] button')].find(b => /^Report /.test(b.textContent.trim())).click()`)
const reported = await until('the report toast', `(() => { const t = document.querySelector('[data-poplur-status-toast]'); return t && /Reported/.test(t.textContent) ? t.textContent.trim() : null })()`, 10_000)
verdict('Report says so and leaves you on the profile', /Reported/.test(reported || '') && (await ev(`Boolean(document.querySelector('[data-poplur-screen="profile"] button[aria-label^="Block or report"]'))`)), reported)
await sleep(2800)
await ev(`document.querySelector('[data-poplur-screen="profile"] button[aria-label^="Block or report"]').click()`)
await until('the dialog again', `Boolean(document.querySelector('[data-profile-safety-dialog] [role="dialog"]'))`, 15_000)
await ev(`[...document.querySelectorAll('[data-profile-safety-dialog] button')].find(b => /^Block /.test(b.textContent.trim())).click()`)
const blocked = await until('the block toast', `(() => { const t = document.querySelector('[data-poplur-status-toast]'); return t && /Blocked/.test(t.textContent) ? t.textContent.trim() : null })()`, 10_000)
await sleep(2500)
const afterBlock = await ev(`(() => ({ profileUp: Boolean(document.querySelector('[data-poplur-screen="profile"] button[aria-label^="Block or report"]')), mapFrame: Boolean(document.querySelector('iframe[title="Poplur clay map"]')) }))()`)
verdict('Block says so, then takes you back to the map you came from', /Blocked/.test(blocked || '') && !afterBlock.profileUp && afterBlock.mapFrame, JSON.stringify({ blocked, ...afterBlock }))
const remaining = await ev(IN(`(w, d) => d.querySelectorAll('[data-map-point-kind="pin"][data-domination-owner=${JSON.stringify(pin.owner)}]').length`))
verdict('their pins are gone from the board', remaining === 0, `${remaining} pin(s) by ${pin.owner} still mounted`)
// The cube: open another stranger's profile, then press the cube.
const pin2 = await until('another stranger\'s pin', IN(PIN), 30_000)
if (pin2 && pin2.owner !== pin.owner) {
  await openProfileFromPin(pin2.id)
  await ev(`(() => { const c = document.querySelector('[data-poplur-cube] canvas, [data-poplur-cube]'); const r = c.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; for (const t of ['pointerdown', 'pointerup']) c.dispatchEvent(new PointerEvent(t, { bubbles: true, isPrimary: true, button: 0, pointerId: 3, clientX: x, clientY: y })); c.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y })); return 1 })()`)
  await sleep(2500)
  const afterCube = await ev(`Boolean(document.querySelector('[data-poplur-screen="profile"] button[aria-label^="Block or report"]'))`)
  verdict('pressing the cube on a visited profile goes back to the previous page', !afterCube, afterCube ? 'still on the profile' : 'left the profile')
} else {
  console.log('  (no second stranger pin mounted — cube check skipped)')
}
await shot('3-after-block.png')
console.log(`\n${verdicts.filter(v => v.ok).length}/${verdicts.length} green`)
chrome.kill(); cleanup(); process.exit(verdicts.every(v => v.ok) ? 0 : 1)
