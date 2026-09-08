#!/usr/bin/env node
// Offline mini-app thumbnails, using the original modelSprite camera and lighting.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const origin = process.argv[2] ?? 'http://127.0.0.1:5173'
const output = join(root, 'public/sprites')
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
    window.modelSprite = (await import('/src/modelSprite.ts')).modelSprite; return true;
  })()`)
  const manifestPath = join(root, 'src/spritePrerender.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const rules = readFileSync(join(root, 'src/miniAppIcons.ts'), 'utf8')
  const models = [...new Set([...rules.matchAll(/model: '([^']+)'/g)].map(m => m[1]).concat('poplur_cube_create.glb'))]
  mkdirSync(output, { recursive: true })
  for (const model of models) {
    const key = `${model}|-18|14|256`
    if (manifest[key]) continue
    const data = await evaluate(`window.modelSprite(${JSON.stringify(model)}, {yaw:-18,pitch:14,size:256})`)
    const filename = `${model.replace(/\.glb$/, '').replace(/[^a-z0-9_-]/gi, '_')}_y-18_p14_s256.png`
    writeFileSync(join(output, filename), Buffer.from(data.split(',')[1], 'base64'))
    manifest[key] = `sprites/${filename}`
    console.log(model)
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

} finally { cleanup() }
