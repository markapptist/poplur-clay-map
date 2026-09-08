#!/usr/bin/env node
// Headless visual and renderer-lifecycle checks; creates no visible working tab.
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = mkdtempSync(join(root, '.qa-particles-'))
const legacy = execFileSync('git', ['show', 'e106cbf:src/VFXParticleSystem.tsx'], { cwd: root, encoding: 'utf8' })
  .replaceAll("from './", "from '../src/")
writeFileSync(join(fixture, 'Legacy.tsx'), legacy)
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
const cleanup = () => { rmSync(fixture, {recursive:true,force:true}); socket?.close(); chrome.kill(); try { rmSync(profile, { recursive: true, force: true }) } catch {} }
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
  await send('Emulation.setDeviceMetricsOverride', {width: 393, height: 852, deviceScaleFactor: 1, mobile: true})
  await send('Performance.enable')
  await evaluate(`(async () => { window.legacy = (await import(${JSON.stringify('/' + fixture.split('/').at(-1) + '/Legacy.tsx')})).default })()`)
  const metrics = async () => Object.fromEntries((await send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]))
  const checks=[]
  for (const effect of ['explosion','fireworks','confetti','rain','fire']) {
    for (const mode of ['legacy','canvas2d']) {
      await evaluate(`window.qa.stop()`); await sleep(150)
      await evaluate(`window.qa.showParticle(${JSON.stringify(effect)}, ${mode==='legacy'?'window.legacy':'undefined'})`)
      await evaluate(`window.dispatchEvent(new CustomEvent('poplur-managed-rendering-operation', {detail:{durationMs:4000}}))`); await sleep(600)
      const before=await metrics(); await sleep(2500); const after=await metrics()
      const data=await evaluate(`({effect:${JSON.stringify(effect)},mode:${JSON.stringify(mode)},snapshot:window.qa.snapshot(),canvasCount:document.querySelectorAll('canvas').length,alpha:[...document.querySelectorAll('canvas')].map(c=>{try {const data=c.getContext('2d')?.getImageData(0,0,c.width,c.height).data;return data ? data.filter((_,i)=>i%4===3).some(v=>v>0) : null}catch{return null}})})`)
      data.taskMilliseconds=(after.TaskDuration-before.TaskDuration)*1000
      data.scriptMilliseconds=(after.ScriptDuration-before.ScriptDuration)*1000
      checks.push(data)
      // A burst has a deliberate gap between explosions. Verify visible
      // pixels during its next burst rather than treating that gap as failure.
      if (mode === 'canvas2d') {
        let visible = data.alpha.some(Boolean)
        for (let sample = 0; !visible && sample < 16; sample++) {
          await evaluate(`window.dispatchEvent(new CustomEvent('poplur-managed-rendering-operation', {detail:{durationMs:2000}}))`)
          await sleep(100)
          visible = await evaluate(`(()=>{const c=document.querySelector('canvas'); const data=c?.getContext('2d')?.getImageData(0,0,c.width,c.height).data; return !!data?.filter((_,i)=>i%4===3).some(v=>v>0)})()`)
        }
        data.visibleDuringCycle = visible
        if (!visible) throw new Error(`${effect} did not paint visible pixels`)
      }
      const screenshot = await send('Page.captureScreenshot',{format:'png'})
      writeFileSync(join(output,`${effect}-${mode}.png`),Buffer.from(screenshot.data,'base64'))
      console.log(JSON.stringify({effect,mode,taskMilliseconds:data.taskMilliseconds,scriptMilliseconds:data.scriptMilliseconds,canvasCount:data.canvasCount,alpha:data.alpha}))
    }
  }
  await evaluate(`window.qa.stop()`); await sleep(500)
  checks.push(await evaluate(`({mode:'closed',snapshot:window.qa.snapshot(),canvasCount:document.querySelectorAll('canvas').length})`))
  writeFileSync(join(output,'particle-comparison.json'),JSON.stringify(checks,null,2))

} finally { cleanup() }
