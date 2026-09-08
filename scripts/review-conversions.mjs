#!/usr/bin/env node
// Headless visual and renderer-lifecycle checks; creates no visible working tab.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const origin = process.argv[2] ?? 'http://127.0.0.1:5173'
const output = join(root, '../.codex/profiling/additional-conversions-20260908')
const profile = mkdtempSync(join(tmpdir(), 'poplur-navigator-bake-'))
const port = 9550 + process.pid % 300
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--mute-audio',
  '--use-gl=angle', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let socket
const cleanup = () => { socket?.close(); chrome.kill(); try { rmSync(profile, { recursive: true, force: true }) } catch {} }
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { cleanup(); process.exit(130) })

try {
  let target
  for (let i = 0; i < 80; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page') } catch {}
    if (target) break
    await sleep(150)
  }
  if (!target) throw new Error('No bake browser')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map()
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id
    const timeout = setTimeout(() => { pending.delete(key); reject(new Error(`Timed out: ${method}`)) }, 90000)
    pending.set(key, { resolve, reject, timeout }); socket.send(JSON.stringify({ id: key, method, params }))
  })
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    const entry = pending.get(message.id)
    if (entry) { pending.delete(message.id); clearTimeout(entry.timeout); message.error ? entry.reject(message.error) : entry.resolve(message.result) }
    if (message.method === 'Fetch.requestPaused') {
      send('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/html' }], body: Buffer.from('<!doctype html><html><body></body></html>').toString('base64') })
    }
  })
  await send('Page.enable')
  await send('Fetch.enable', { patterns: [{ urlPattern: `${origin}/__navigator_bake__`, resourceType: 'Document' }] })
  await send('Page.navigate', { url: `${origin}/__navigator_bake__` })
  await sleep(300)
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  await evaluate(`(async () => {
    const Refresh = (await import('/@react-refresh')).default;
    Refresh.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    window.qa = await import('/scripts/authoring/ConversionReview.tsx'); return true;
  })()`)
  await send('Emulation.setDeviceMetricsOverride', {width: 1080, height: 1000, deviceScaleFactor: 1, mobile: false})
  const checks = []
  await evaluate(`window.contexts = []; const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...rest) { window.contexts.push(type); return original.call(this, type, ...rest) };`)
  for (const mode of ['objects','apps','controls']) {
    await evaluate(`window.qa.show(${JSON.stringify(mode)})`)
    await sleep(mode === 'particles' ? 1400 : 900)
    const check = await evaluate(`({mode:${JSON.stringify(mode)},contexts:window.contexts,images:[...document.images].map(i=>({src:i.getAttribute('src'),ok:i.complete && i.naturalWidth>0})),renderers:window.qa.snapshot(), canvases:document.querySelectorAll('canvas').length})`)
    checks.push(check)
    const screenshot = await send('Page.captureScreenshot', {format:'png'})
    writeFileSync(join(output, `${mode}.png`), Buffer.from(screenshot.data,'base64'))
  }
  await evaluate(`window.contexts = []`)
  for (const [model, face] of [
    ['poplur_cube_settings.glb'], ['poplur_cube_wallet.glb'], ['poplur_cube_mail.glb'],
    ['poplur_cube_search.glb'], ['poplur_radio.glb'], ['games/poplurstation/controller.glb'],
    ['subscreens/store-models/poplur_card_lens.glb'],
    ...[1,2,3,4,5,6].map(face=>['poplur_dice_lite.glb',face]),
  ]) {
    await evaluate(`window.qa.showNavigator(${JSON.stringify(model)}, ${face ?? 'undefined'})`)
    await sleep(600)
    const poses=[]
    for (const roll of [0, .25, -.25]) {
      await evaluate(`window.dispatchEvent(new CustomEvent('poplur-native-motion',{detail:{roll:${roll},pitch:1}}))`)
      await sleep(130)
      const pose=await evaluate(`(async()=>{const i=document.querySelector('[data-poplur-navigator-sprite]');await i.decode();return {src:i.getAttribute('src'),ok:i.complete&&i.naturalWidth>0}})()`)
      if (!pose.ok || !pose.src.includes(`y${roll===0?0:roll>0?24:-24}_p0`) || (face && !pose.src.endsWith(`_f${face}.webp`))) throw new Error(`Invalid motion view: ${model} ${JSON.stringify(pose)}`)
      poses.push(pose)
      if (model === 'poplur_cube_settings.glb') {
        const screenshot=await send('Page.captureScreenshot',{format:'png'})
        writeFileSync(join(output,`navigator-settings-${roll===0?'centre':roll>0?'right':'left'}.png`),Buffer.from(screenshot.data,'base64'))
      }
    }
    checks.push({mode:'navigator',model,face,poses,...await evaluate(`({contexts:window.contexts,renderers:window.qa.snapshot(),canvases:document.querySelectorAll('canvas').length})`)})
  }
  await evaluate(`window.qa.stop()`); await sleep(500)
  checks.push(await evaluate(`({mode:'closed',renderers:window.qa.snapshot(),canvases:document.querySelectorAll('canvas').length})`))
  writeFileSync(join(output, 'visual-checks.json'), JSON.stringify(checks,null,2))
  console.log(JSON.stringify(checks.map(c=>({mode:c.mode,canvases:c.canvases,contexts:c.contexts?.filter(x=>x!=='2d'),failedImages:c.images?.filter(i=>!i.ok),activeHeavy:c.renderers.activeHeavyRendererCount,activeLight:c.renderers.activeLightRendererCount}))))

} finally { cleanup() }
