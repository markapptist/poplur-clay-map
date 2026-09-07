#!/usr/bin/env node
// Offline authoring pass. Uses CubeTab3D's real fitting, materials and lights.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const origin = process.argv[2] ?? 'http://127.0.0.1:5173'
const output = join(root, 'public/navigator-sprites')
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
    window.bake = (await import('/src/WebGLNavigator.tsx')).bakeNavigatorSprites; return true;
  })()`)
  const models = readdirSync(join(root, 'public')).filter(name => name.endsWith('.glb') && statSync(join(root, 'public', name)).size < 2_000_000)
  models.push('games/poplurstation/console.glb', 'games/poplurstation/controller.glb')
  models.push(...['inverted', 'lens', 'split_diamond', 'swoosh'].map(name => `subscreens/store-models/poplur_card_${name}.glb`))
  const swaying = new Set(['clay_tv.glb', 'poplur_mark_head_navigator.glb', 'poplur_female_head_navigator.glb',
    'poplur_camera_kodak.glb', 'poplur_cube_camcorder.glb', 'poplur_clay_phone_lite.glb', 'poplur-globe-lite.glb'])
  const requested = process.argv.slice(3)
  const manifest = requested.length ? JSON.parse(readFileSync(join(root, 'src/navigatorSprites.json'), 'utf8')) : {}
  mkdirSync(output, { recursive: true })
  for (const model of models) {
    if (requested.length && !requested.includes(model)) continue
    const poses = model === 'poplur_dice_lite.glb' ? [1, 2, 3, 4, 5, 6].map(face => ({ yaw: 0, pitch: 0, face })) : swaying.has(model)
      ? [-16, 0, 16].flatMap(pitch => [-24, -16, -8, 0, 8, 16, 24].map(yaw => ({ yaw, pitch })))
      : [{ yaw: 0, pitch: 0 }]
    const frames = await evaluate(`window.bake(${JSON.stringify(model)}, ${JSON.stringify(poses)})`)
    manifest[model] = frames.map(({ yaw, pitch, face, data }) => {
      const filename = `${model.replace(/\.glb$/, '').replace(/[^a-z0-9_-]/gi, '_')}_y${yaw}_p${pitch}${face ? `_f${face}` : ''}.webp`
      writeFileSync(join(output, filename), Buffer.from(data.split(',')[1], 'base64'))
      return { yaw, pitch, ...(face ? { face } : {}), src: `navigator-sprites/${filename}` }
    })
    console.log(`${model}: ${frames.length} views`)
  }
  writeFileSync(join(root, 'src/navigatorSprites.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`Baked ${Object.keys(manifest).length} models; runtime needs no GLB decode or WebGL context.`)
} finally { cleanup() }
