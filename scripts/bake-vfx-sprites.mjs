#!/usr/bin/env node
// Offline stock VFX objects, using the editor model-viewer camera with full-object framing.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const origin = process.argv[2] ?? 'http://127.0.0.1:5173'
const output = join(root, 'public/vfx-sprites')
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
    await import('/src/CustomVFXModel.tsx'); return true;
  })()`)
  const models = {
    globe: '/poplur-globe-lite.glb', camera: '/poplur_camera_kodak.glb',
    tv: '/clay_tv_navigator.glb', mic: '/poplur_mic_lite.glb',
    plane: '/models/plane.glb', pin: '/poplur_pin_lite.glb',
  }
  mkdirSync(output, { recursive: true })
  for (const [name, src] of Object.entries(models)) {
    const data = await evaluate(`(async () => {
      const viewer = document.createElement('model-viewer');
      viewer.style.cssText = 'display:block;width:512px;height:512px;background:transparent';
      viewer.setAttribute('camera-orbit','20deg 72deg 105%');
      viewer.setAttribute('field-of-view','28deg');
      viewer.setAttribute('exposure','1.2');
      viewer.setAttribute('shadow-intensity','0');
      viewer.setAttribute('interaction-prompt','none');
      const loaded = new Promise((resolve,reject) => {
        viewer.addEventListener('load', resolve, {once:true});
        viewer.addEventListener('error', reject, {once:true});
      });
      viewer.src = ${JSON.stringify(src)};
      document.body.append(viewer);
      await loaded; await viewer.updateComplete;
      await new Promise(r => setTimeout(r,500));
      const data = viewer.toDataURL('image/png'); viewer.remove(); return data;
    })()`)
    writeFileSync(join(output, `${name}.png`), Buffer.from(data.split(',')[1], 'base64'))
    console.log(name)
  }

} finally { cleanup() }
