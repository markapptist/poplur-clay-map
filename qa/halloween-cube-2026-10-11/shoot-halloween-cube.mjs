// Headless proof probe: loads the running dev server, checks which navigator
// sprite each view wears, and saves screenshots. Audio muted and speech
// synthesis suppressed in every frame before navigation (silent browser rule).
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const origin = 'http://127.0.0.1:5173'
const outDir = process.argv[2]
const profile = mkdtempSync(join(tmpdir(), 'poplur-halloween-shoot-'))
const port = 9850 + process.pid % 100
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--mute-audio', '--autoplay-policy=user-gesture-required',
  '--use-gl=angle', '--window-size=390,844', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let socket
const cleanup = () => { socket?.close(); chrome.kill(); try { rmSync(profile, { recursive: true, force: true }) } catch {} }
const results = {}
try {
  let target
  for (let i = 0; i < 80; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page') } catch {}
    if (target) break
    await sleep(150)
  }
  if (!target) throw new Error('No browser')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(r => socket.addEventListener('open', r, { once: true }))
  let id = 0; const pending = new Map()
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id
    const t = setTimeout(() => { pending.delete(key); reject(new Error(`Timed out: ${method}`)) }, 60000)
    pending.set(key, { resolve, reject, t }); socket.send(JSON.stringify({ id: key, method, params }))
  })
  socket.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data); const e = pending.get(m.id)
    if (e) { pending.delete(m.id); clearTimeout(e.t); m.error ? e.reject(m.error) : e.resolve(m.result) }
  })
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    try { if (window.speechSynthesis) { window.speechSynthesis.speak = () => {}; window.speechSynthesis.cancel = () => {}; } } catch {}
    try {
      const play = HTMLMediaElement.prototype.play
      HTMLMediaElement.prototype.play = function () { this.muted = true; this.volume = 0; return play.call(this) }
    } catch {}
    try { const AC = window.AudioContext || window.webkitAudioContext; if (AC) { window.AudioContext = class extends AC { constructor(...a) { super(...a); this.suspend(); } } } } catch {}
  ` })
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  const navigatorSrc = () => evaluate(`(() => {
    const imgs = [...document.querySelectorAll('img')].map(i => i.getAttribute('src') || '').filter(s => s.includes('navigator-sprites/'))
    return imgs[imgs.length - 1] || null
  })()`)
  const shots = [
    { name: 'profile-root', url: `${origin}/?view=profile`, expect: 'poplur_cube_jackolantern' },
    { name: 'profile-avatar-screen', url: `${origin}/?view=holdmenu&holdScreen=profile-avatar`, expect: 'poplur_cube_printer' },
    { name: 'feed-control', url: `${origin}/?view=feed`, expect: 'clay_tv' },
  ]
  for (const shot of shots) {
    await send('Page.navigate', { url: shot.url })
    let src = null
    for (let i = 0; i < 100; i++) {
      await sleep(300)
      try { src = await navigatorSrc() } catch { src = null }
      if (src && src.includes(shot.expect)) break
    }
    await sleep(1500)
    src = await navigatorSrc()
    const { data } = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(outDir, `${shot.name}.png`), Buffer.from(data, 'base64'))
    results[shot.name] = { url: shot.url, navigatorSprite: src, ok: Boolean(src && src.includes(shot.expect)) }
    console.log(shot.name, '→', src, results[shot.name].ok ? 'OK' : 'UNEXPECTED')
  }
  writeFileSync(join(outDir, 'probe.json'), JSON.stringify({ shotAt: new Date().toISOString(), results }, null, 2) + '\n')
} finally { cleanup() }
