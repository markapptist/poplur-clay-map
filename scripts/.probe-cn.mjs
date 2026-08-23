import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const profile = mkdtempSync(join(tmpdir(), 'cn-'))
const port = 9445
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--use-gl=angle', '--use-angle=metal', '--enable-unsafe-swiftshader',
  '--window-size=430,900', 'http://localhost:5199/?map=1',
], { stdio: 'ignore' })
process.on('exit', () => { try { chrome.kill() } catch {} try { rmSync(profile,{recursive:true,force:true}) } catch {} })
async function tg(){for(let i=0;i<80;i++){try{const l=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const p=l.find(t=>t.type==='page'&&t.url.includes('5199')); if(p)return p.webSocketDebuggerUrl}catch{}
await new Promise(r=>setTimeout(r,500))} throw 'no'}
const ws=new WebSocket(await tg()); await new Promise(r=>{ws.onopen=r}); let seq=0
const logs = []
ws.addEventListener('message', e => {
  const x = JSON.parse(e.data)
  if (x.method === 'Runtime.consoleAPICalled') {
    const msg = x.params.args.map(a => a.value ?? a.description ?? '').join(' ')
    if (/landmark|glb|cn-tower|liberty|burj|eiffel|3d/i.test(msg)) logs.push(msg)
  }
})
const send=(m,p={})=>new Promise((res,rej)=>{const id=++seq
 const on=e=>{const x=JSON.parse(e.data); if(x.id!==id)return; ws.removeEventListener('message',on)
  x.error?rej(new Error(x.error.message)):res(x.result)}
 ws.addEventListener('message',on)
 ws.send(JSON.stringify({id,method:m,params:p}))})
await send('Runtime.enable')
const ev=x=>send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true}).then(r=>r.result?.value).catch(()=>null)

await new Promise(r=>setTimeout(r,20000))
for (let i=0;i<4;i++){
  await ev(`(() => { const m=window.__poplurMap||window.__map
    if(m){m.stop(); m.jumpTo({center:[-79.3871,43.6426], zoom:15.5, pitch:60, bearing:45})} return true})()`)
  await new Promise(r=>setTimeout(r,3000))
}
await new Promise(r=>setTimeout(r,6000))
const state = await ev(`(() => {
  const m = window.__poplurMap || window.__map
  return JSON.stringify({
    zoom: +m.getZoom().toFixed(2),
    projection: m.getProjection().name,
    cnLayer: !!m.getLayer('landmark3d-cn-tower'),
  })
})()`)
console.log('state:', state)
console.log('---logs---')
for (const l of logs) console.log(l)

// Query cn tower layer render state
const rs = await ev(`(() => {
  const m = window.__poplurMap || window.__map
  const layer = m.style?.getLayer?.('landmark3d-cn-tower')
  const impl = layer && layer.implementation
  const out = { hasImpl: !!impl, hasScene: !!impl?.scene }
  if (impl && impl.scene) {
    out.sceneKids = impl.scene.children.length
    out.sceneKidTypes = impl.scene.children.map(c => c.type)
  }
  return JSON.stringify(out)
})()`)
console.log('layer state:', rs)

const shotPath = '/tmp/cn-final.png'
const shot = await send('Page.captureScreenshot', {format:'png'})
writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))
console.log('shot:', shotPath)
process.exit(0)
