import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const TARGET = process.argv[2] || 'eiffel'
const SPOTS = {
  eiffel: [2.2945, 48.8584], 'cn-tower': [-79.3871, 43.6426],
  'burj-khalifa': [55.2744, 25.1972], 'statue-liberty': [-74.0445, 40.6892],
}
const [lng, lat] = SPOTS[TARGET]
const Z = +(process.env.Z || 15.0)
const profile = mkdtempSync(join(tmpdir(), 'lm-'))
const port = 9447
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
const errs=[]
ws.addEventListener('message', e => { const x=JSON.parse(e.data)
  if (x.method==='Runtime.consoleAPICalled'){const m=x.params.args.map(a=>a.value??a.description??'').join(' ')
    if(/error|fail|not.*supported|exception|GLOBEDIAG/i.test(m)) errs.push(m.slice(0,600))}
  if (x.method==='Runtime.exceptionThrown') errs.push('EXC '+JSON.stringify(x.params.exceptionDetails).slice(0,220))})
const send=(m,p={})=>new Promise((res,rej)=>{const id=++seq
 const on=e=>{const x=JSON.parse(e.data); if(x.id!==id)return; ws.removeEventListener('message',on)
  x.error?rej(new Error(x.error.message)):res(x.result)}
 ws.addEventListener('message',on); ws.send(JSON.stringify({id,method:m,params:p}))})
await send('Runtime.enable')
const ev=x=>send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true}).then(r=>r.result?.value).catch(e=>'ERR '+e)
await ev(`window.__lmRot = ${process.env.ROT ?? -0.5}`)
await new Promise(r=>setTimeout(r,20000))
await ev(`window.__lmRot = ${process.env.ROT ?? -0.5}`)
for (let i=0;i<4;i++){
  await ev(`(()=>{const m=window.__poplurMap||window.__map
    if(m){m.stop(); m.jumpTo({center:[${lng},${lat}], zoom:${Z}, pitch:58, bearing:25})} return 1})()`)
  await new Promise(r=>setTimeout(r,3000))
}
await new Promise(r=>setTimeout(r,11000))
const state = await ev(`(()=>{const m=window.__poplurMap||window.__map
  const p=m.project([${lng},${lat}])
  const q=(L)=>{try{return m.queryRenderedFeatures([[p.x-140,p.y-140],[p.x+140,p.y+140]],{layers:[L]}).length}catch(e){return 'x'}}
  return JSON.stringify({
    proj: m.getProjection().name,
    zoom:+m.getZoom().toFixed(2),
    lmLayer: !!m.getLayer('landmark3d-${TARGET}'),
    buildings: q('clay-buildings-3d'),
    caps: q('clay-building-caps'),
    roads: q('clay-real-road'),
  })})()`)
console.log('state:', state)
if (errs.length) { console.log('--- errors ---'); errs.slice(0,8).forEach(e=>console.log(e)) }
const shot = await send('Page.captureScreenshot',{format:'png'})
const out = `/tmp/lm-${TARGET}.png`
writeFileSync(out, Buffer.from(shot.data,'base64'))
console.log('shot:', out)
process.exit(0)
