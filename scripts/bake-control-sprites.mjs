#!/usr/bin/env node
// Offline authoring pass. Uses CubeTab3D's real fitting, materials and lights.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const origin = process.argv[2] ?? 'http://127.0.0.1:5173'
const output = join(root, 'public/control-sprites')
const profile = mkdtempSync(join(tmpdir(), 'poplur-control-bake-'))
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
  await send('Fetch.enable', { patterns: [{ urlPattern: `${origin}/__navigator_bake__?uiRenderer=legacy`, resourceType: 'Document' }] })
  await send('Page.navigate', { url: `${origin}/__navigator_bake__?uiRenderer=legacy` })
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
    window.bake = (await import('/src/WebGLNavigator.tsx')).bakeNavigatorSprites; return true;
  })()`)

  await evaluate(`(async () => {
    const ReactModule = await import('/node_modules/.vite/deps/react.js');
    const React = ReactModule.default ?? ReactModule;
    const DOMModule = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { createRoot } = DOMModule.default ?? DOMModule;
    const Corner = (await import('/scripts/authoring/ClayCornerButton.tsx')).default;
    const Mute = (await import('/scripts/authoring/ClayMuteButton.tsx')).default;
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    window.bakeControl = async (kind, active, tone) => {
      root.render(React.createElement(kind === 'mute' ? Mute : Corner, {
        key: kind + active + tone, kind, active, tone, muted: active, size: 96, still: true,
        label: 'Authoring control', onPress: () => {}, onToggle: () => {}
      }));
      await new Promise(resolve => setTimeout(resolve, 120));
      const canvas = container.querySelector('canvas');
      if (!canvas || canvas.width < 20) throw new Error('Control did not render: ' + kind);
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      if (!data.some((value, index) => index % 4 === 3 && value > 0)) throw new Error('Empty control: ' + kind);
      return canvas.toDataURL('image/png');
    };
    return true;
  })()`)
  const kinds = ['flash','flip','close','share','link','send','capture','mail','search','locate','heart',
    'thumbUp','thumbDown','comment','comments','play','seekBack','seekFwd','roll','live','delete','block','mute']
  const manifest = {}
  mkdirSync(output, { recursive: true })
  for (const kind of kinds) for (const active of [false, true]) for (const tone of kind === 'mute' ? ['clay'] : ['clay','cream']) {
    const data = await evaluate(`window.bakeControl(${JSON.stringify(kind)}, ${active}, ${JSON.stringify(tone)})`)
    const filename = `${kind}-${active ? 'on' : 'off'}-${tone}.png`
    writeFileSync(join(output, filename), Buffer.from(data.split(',')[1], 'base64'))
    manifest[`${kind}|${active}|${tone}`] = `control-sprites/${filename}`
    console.log(filename)
  }
  writeFileSync(join(root, 'src/sharedClayControls.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`Baked ${Object.keys(manifest).length} exact control states.`)

} finally { cleanup() }
