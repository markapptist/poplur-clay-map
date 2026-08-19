// The five Twitter behaviours on News.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const BASE = process.argv[2] ?? 'http://127.0.0.1:5173'
const OUT = process.argv[3]
const PORT = 9549
const dir = mkdtempSync(join(tmpdir(), 'n5-'))
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
const waitFor = async (e, ms, s = 350) => { const u = Date.now() + ms; while (Date.now() < u) { if (await ev(`!!(${e})`)) return true; await sleep(s) } return false }
const shot = async n => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r?.result?.data && OUT) writeFileSync(join(OUT, n), Buffer.from(r.result.data, 'base64')) }
const setInput = (sel, v) => ev(`(() => {
  const el = document.querySelector(${JSON.stringify(sel)})
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)

await send('Page.navigate', { url: `${BASE}/?view=holdmenu&holdScreen=feed-news` })
check('news mounts', await waitFor(`document.querySelector('[data-pull-panel]')`, 30_000))
await sleep(2500)

// ── 1. refresh brings NEW posts ────────────────────────────────────────────
const firstBodies = await ev(`[...document.querySelectorAll('[class*="timeline"] article p')].slice(0,4).map(p => p.textContent)`)
await ev(`(async () => {
  const fire = (el,ty,x,y) => el.dispatchEvent(new PointerEvent(ty,{bubbles:true,cancelable:true,composed:true,pointerId:7,pointerType:'touch',isPrimary:true,clientX:x,clientY:y,buttons:ty==='pointerup'?0:1}))
  const host = document.querySelector('[data-pull-panel]').parentElement
  const r = host.getBoundingClientRect(); const x = r.x + r.width/2; let y = r.y + 80
  fire(host,'pointerdown',x,y)
  for (let s=0;s<16;s++){ y+=18; fire(host,'pointermove',x,y); await new Promise(f=>setTimeout(f,16)) }
  fire(host,'pointerup',x,y); return true })()`)
await sleep(2600)
const newBodies = await ev(`[...document.querySelectorAll('[class*="timeline"] article p')].slice(0,4).map(p => p.textContent)`)
check('pull-to-refresh sets NEW posts', JSON.stringify(firstBodies) !== JSON.stringify(newBodies),
  `${(firstBodies||[])[0]?.slice(0,28)}… → ${(newBodies||[])[0]?.slice(0,28)}…`)
check('a "new posts" banner announces them', await ev(`!!document.querySelector('[class*="freshBanner"]')`))
await shot('news5-refresh.png')

// ── 2 + 4. detail view: radius, coordinates, map plate ─────────────────────
await ev(`document.querySelector('[class*="timeline"] article').click()`)
check('a post opens a detail view', await waitFor(`document.querySelector('[class*="detail"][role=dialog]')`, 6000))
const facts = await ev(`(() => {
  const d = document.querySelector('[class*="detailFacts"]')
  if (!d) return null
  return { labels: [...d.querySelectorAll('dt')].map(e => e.textContent),
           values: [...d.querySelectorAll('dd')].map(e => e.textContent) }
})()`)
check('detail shows RADIUS', (facts?.labels ?? []).includes('RADIUS'), JSON.stringify(facts?.values))
check('detail shows the posting coordinate',
  /-?\d+\.\d{4},\s*-?\d+\.\d{4}/.test((facts?.values ?? []).join(' ')), JSON.stringify(facts?.values?.[2]))
// Existence is not enough — the plate has to actually DECODE, or the detail
// shows a caption over nothing.
await waitFor(`(document.querySelector('[class*="detailPlate"] img')?.naturalWidth ?? 0) > 0`, 12_000)
const plate = await ev(`(() => {
  const img = document.querySelector('[class*="detailPlate"] img')
  if (!img) return { found: false }
  return { found: true, w: img.naturalWidth, h: img.naturalHeight, box: Math.round(img.getBoundingClientRect().height) }
})()`)
check('detail shows a map of that ground (loaded, not just present)',
  plate.found && plate.w > 0 && plate.box > 40, JSON.stringify(plate))
await shot('news5-detail.png')

// ── 2b. profile route from the detail ──────────────────────────────────────
check('detail offers their profile', await ev(`!!document.querySelector('[class*="detailProfile"]')`))
await ev(`document.querySelector('[class*="detailProfile"]').click()`)
check('profile opens on Messages', await waitFor(`[...document.querySelectorAll('[class*="modeLabel"]')].some(e => /Messages/i.test(e.textContent) && (e.closest('button')?.className||'').includes('modeOn'))`, 15_000))
await shot('news5-profile.png')

// ── 3. hamburger: search a user, search a post ─────────────────────────────
await send('Page.navigate', { url: `${BASE}/?view=holdmenu&holdScreen=feed-news` })
await waitFor(`document.querySelector('[aria-label="Open news menu"]')`, 30_000)
await sleep(2200)
await ev(`document.querySelector('[aria-label="Open news menu"]').click()`)
await waitFor(`document.querySelector('[role=dialog][aria-label="News menu"]')`, 5000)
check('drawer offers POSTS and USERS', await ev(`[...document.querySelectorAll('[role=tab]')].map(b=>b.textContent).join(',')`) === 'POSTS,USERS')
await setInput('[aria-label="Search for a post"]', 'mural')
await sleep(600)
const postHits = await ev(`document.querySelectorAll('[class*="timeline"] article').length`)
check('post search filters the paper', postHits > 0, `${postHits} stories`)
await ev(`[...document.querySelectorAll('[role=tab]')].find(b=>/USERS/.test(b.textContent)).click()`)
await sleep(400)
await setInput('[aria-label="Search for a user"]', 'harbour')
await sleep(700)
const people = await ev(`[...document.querySelectorAll('[class*="personPick"] b')].map(e=>e.textContent)`)
check('user search lists people', (people ?? []).length > 0, JSON.stringify(people))
await shot('news5-users.png')
await ev(`document.querySelector('[class*="personPick"]').click()`)
await sleep(900)
const narrowed = await ev(`(() => ({ chip: !!document.querySelector('[class*="filterChip"]'), n: document.querySelectorAll('[class*="timeline"] article').length }))()`)
check('picking a user narrows the paper to them', narrowed.chip && narrowed.n > 0, JSON.stringify(narrowed))

// ── 5. day / night ─────────────────────────────────────────────────────────
const mode = await ev(`document.querySelector('[data-daylight]')?.dataset.daylight`)
check('paper declares a day/night mode', mode === 'day' || mode === 'night', String(mode))
const bg = await ev(`getComputedStyle(document.querySelector('[data-daylight]')).backgroundColor`)
check('night is dark / day is light', mode === 'night' ? /rgb\((1?\d|[0-2]\d),/.test(bg) : true, `${mode}: ${bg}`)
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures ? 1 : 0)
