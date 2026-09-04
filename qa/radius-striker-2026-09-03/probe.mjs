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

// 1. The Map found the viewer and told the shell (poplur-map-location).
const shellFix = await until('the shell fix', `JSON.stringify(window.__poplurNativeLocation || null)`, 45_000).catch(() => 'null')
const fix = JSON.parse(shellFix)
verdict('shell learned the viewer fix from the map', Boolean(fix && fix.source === 'map'), shellFix)

// 2. Arrow onto a pin: the striker climbs, rings trophies, the counter recounts.
const counterBefore = await ev(`document.querySelector('[data-counter-value]')?.dataset.counterValue ?? null`)
let card = null
for (let step = 0; step < 40 && !card; step++) {
  await ev(IN(`(w) => { w.postMessage({ type: 'poplur-map-action', action: 'cycleMapPoint', dir: 1 }, '*'); return 1 }`))
  await sleep(350)
  const kind = await ev(IN(`(w, d) => d.querySelector('[data-map-point-card]')?.dataset.mapPointKind ?? null`))
  const radiusVisible = await ev(IN(`(w, d) => d.querySelector('[data-map-point-card]')?.dataset.mapPointRadiusVisible ?? null`))
  if (kind === 'pin' && radiusVisible === 'true') {
    card = await ev(IN(`(w, d) => { const c = d.querySelector('[data-map-point-card]'); return { id: c.dataset.mapPointId, name: c.querySelector('[data-map-point-name]')?.textContent, km: Number(c.querySelector('[data-map-point-radius-km]')?.dataset.mapPointRadiusKm) } }`))
  }
}
verdict('arrowed onto a pin', Boolean(card), JSON.stringify(card))
const samples = []
const t0 = Date.now()
// Sample until the striker reports settled (or 6 s under a loaded machine):
// the climb is 880 ms of wall clock, but a busy host can starve CDP round
// trips, so a fixed window would judge an unfinished climb.
while (Date.now() - t0 < 6000) {
  const settled = samples.length > 1 && samples[samples.length - 1] && samples[samples.length - 1].running === 'false'
  if (settled && Date.now() - t0 > 1200) break
  samples.push(await ev(IN(`(w, d) => { const z = d.querySelector('[data-radius-striker]'); return z ? { t: ${Date.now()} - ${t0}, tier: z.dataset.radiusStriker, running: z.dataset.radiusStrikerRunning, level: z.dataset.radiusStrikerLevel, thumb: d.querySelector('[data-zoom-thumb]')?.dataset.zoomThumb, marks: d.querySelectorAll('[data-tier]').length, progress: getComputedStyle(z).getPropertyValue('--zoomProgress').trim() } : null }`)))
  await sleep(60)
}
const seen = samples.filter(Boolean)
const tiers = [...new Set(seen.map(s => s.tier))]
const thumbs = [...new Set(seen.map(s => s.thumb))]
const last = seen[seen.length - 1]
verdict('zoom rail became a radius striker', seen.length > 0, `${seen.length} samples, tiers ${JSON.stringify(tiers)}, thumbs ${JSON.stringify(thumbs)}`)
verdict('striker settled at the pin\'s radius', Boolean(last && last.running === 'false'), JSON.stringify(last))
verdict('tier notches drawn on the rail', Boolean(last && last.marks === 5), `${last?.marks} marks`)
const counterAfter = await ev(`document.querySelector('[data-counter-value]')?.dataset.counterValue ?? null`)
const radiusLabel = await ev(`document.querySelector('[aria-label^="Radius "]')?.getAttribute('aria-label') ?? null`)
verdict('RADIUS card shows the pin\'s radius', Boolean(radiusLabel && card && Math.abs(parseFloat(radiusLabel.replace('Radius ', '')) - (radiusLabel.includes('miles') ? card.km * 0.621371 : card.km)) < 0.15), `${counterBefore} → ${counterAfter} · ${radiusLabel} · pin ${card?.km} km`)
await shot('1-striker-on-pin.png')

// 2b. The conquer cohort: five strangers' pins, five colours, standing in the
// same downtown ground. Markers mount near the viewport, so count whatever the
// arrival camera can see and report the distinct owners.
const cohort = await ev(IN(`(w, d) => { const roots = [...d.querySelectorAll('[data-map-point-id^="pin:firestore:post-radius-lab-cohort"]')]; return { pins: roots.length, owners: [...new Set(roots.map(r => r.dataset.dominationOwner))], labels: roots.slice(0, 10).map(r => r.querySelector('button')?.getAttribute('aria-label')) } }`))
verdict('cohort pins standing on the board', Boolean(cohort && cohort.pins > 0), JSON.stringify(cohort))

// 3. Tap the pin: the Poplur dialog opens with the pop and one button to the feed.
// A live pin's marker root carries data-map-point-id="pin:firestore:<postId>"
// (ClayMap.buildMarker) and the press target is the BUTTON inside it. The
// selection highlight root carries the same id with no button, so select the
// button directly. Markers mount after the flight settles — wait for one.
const pinId = card?.id ?? null
const PIN_BUTTON = `(d.querySelector('[data-map-point-id=' + JSON.stringify(${JSON.stringify(pinId)}) + '] button') || d.querySelector('[data-map-point-id^="pin:firestore:"] button'))`
await until('the pin marker to mount', IN(`(w, d) => Boolean(${PIN_BUTTON})`), 20_000).catch(() => null)
const tapped = await ev(IN(`(w, d) => { const el = ${PIN_BUTTON}; if (!el) return null; el.click(); return el.parentElement.dataset.mapPointId }`))
const dialog = await until('the Poplur dialog', IN(`(w, d) => { const s = d.querySelector('[data-poplur-dialog]'); if (!s) return null; return { id: s.dataset.poplurDialog, title: s.querySelector('h2')?.textContent, pills: [...s.querySelectorAll('[class*="pill"]')].map(p => p.textContent.trim()).filter(Boolean), buttons: [...s.querySelectorAll('button')].map(b => b.textContent.trim()) } }`), 15_000).catch(() => null)
verdict('tapping a pin opens the Poplur dialog', Boolean(dialog), `${tapped} → ${JSON.stringify(dialog)}`)
await shot('2-poplur-dialog.png')

// 4. See in Feed: the shell switches to the feed on that channel with THAT post first.
// The dialog is a transient popup (10 s TTL) and a screenshot on a loaded host
// can outlast it, so re-open it and press the button in the same breath.
const reopened = await ev(IN(`(w, d) => { const el = ${PIN_BUTTON}; if (!el) return null; el.click(); return el.parentElement.dataset.mapPointId }`))
await until('the Poplur dialog again', IN(`(w, d) => Boolean(d.querySelector('[data-poplur-dialog] button'))`), 15_000).catch(() => null)
const feedButton = await ev(IN(`(w, d) => { const b = [...d.querySelectorAll('[data-poplur-dialog] button')].find(x => /see in feed/i.test(x.textContent)); if (!b) return null; b.click(); return b.textContent.trim() }`))
console.log(`  reopened ${reopened}, pressed ${JSON.stringify(feedButton)}`)
verdict('dialog offers See in Feed', Boolean(feedButton), feedButton)
const feedPost = await until('the feed to show the pop', `(() => { const el = document.querySelector('[data-feed-post-id]'); return el ? el.dataset.feedPostId : null })()`, 30_000).catch(() => null)
const tappedPostId = (tapped ?? '').replace(/^pin:/, '').replace(/^firestore:/, '')
verdict('feed opened on the tapped post', Boolean(feedPost) && feedPost === tappedPostId, `feed shows ${feedPost}, tapped ${tappedPostId}`)

// 5. The POST RADIUS card on the feed reports THAT post's reach — the same
// number the dialog's pill showed — once the first-run coach card is out of
// the way. Sample for a while: the card re-counts on arrival and a loaded
// host makes every round trip slow.
const RADIUS_LABEL = `(() => { const el = document.querySelector('[aria-label^="Radius "]'); return el ? el.getAttribute('aria-label') : null })()`
const radiusSamples = []
for (let i = 0; i < 8; i++) { radiusSamples.push(await ev(RADIUS_LABEL)); await sleep(500) }
const coach = await ev(`(() => { const p = [...document.querySelectorAll('p')].find(x => /tap anywhere to start/i.test(x.textContent)); if (!p) return null; (p.closest('[role]') || p.parentElement).click(); return 'dismissed' })()`)
for (let i = 0; i < 10; i++) { radiusSamples.push(await ev(RADIUS_LABEL)); await sleep(500) }
const lastRadius = radiusSamples[radiusSamples.length - 1]
const pillMi = dialog?.pills?.find(p => /radius/i.test(p))?.match(/([\d,.]+)\s*(mi|km)/)
const expectedMi = pillMi ? Number(pillMi[1].replace(/,/g, '')) * (pillMi[2] === 'km' ? 0.621371 : 1) : null
const shownMi = lastRadius ? Number(lastRadius.replace('Radius ', '').split(' ')[0]) * (lastRadius.includes('kilometres') ? 0.621371 : 1) : null
verdict('POST RADIUS card reads the tapped post\'s radius', expectedMi != null && shownMi != null && Math.abs(shownMi - expectedMi) <= Math.max(0.2, expectedMi * 0.002), `coach ${coach} · expected ≈${expectedMi} mi · samples ${JSON.stringify(radiusSamples.map(s => s && s.replace(' — tap to change units', '')))}`)
await shot('3-feed-on-tapped-post.png')

writeFileSync(join(OUT, 'verdicts.json'), JSON.stringify({ origin: ORIGIN, at: new Date().toISOString(), verdicts, samples: seen }, null, 2))
console.log(`\n${verdicts.filter(v => v.ok).length}/${verdicts.length} green · ${OUT}`)
chrome.kill()
cleanup()
process.exit(verdicts.every(v => v.ok) ? 0 : 1)
