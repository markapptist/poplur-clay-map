import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { onFrame } from './frameGovernor'
import { PoplurPerformanceManager } from './poplurPerformanceManager'
import { releaseWebGL } from './threeCleanup'
import styles from './HomeTwin.module.css'

// Browser twin of the APPROVED Good Copy Loading screen (gcl-prototype.html
// loadingPage()): the clay globe is the real poplur-globe-lite.glb turning
// under the wordmark, over the pulsing dot-map and confetti, with the splash's
// shader-swept text and candy-stripe clay bar.

const LAND: Array<Array<[number, number]>> = [
  [[.02,.13],[.08,.08],[.17,.07],[.25,.12],[.31,.20],[.27,.27],[.23,.30],[.21,.38],[.15,.43],[.10,.37],[.06,.34],[.03,.27]],
  [[.20,.04],[.27,.05],[.30,.11],[.27,.17],[.22,.15],[.18,.09]],
  [[.16,.39],[.23,.40],[.29,.47],[.31,.57],[.28,.68],[.25,.79],[.22,.91],[.18,.82],[.16,.70],[.13,.56],[.13,.46]],
  [[.39,.18],[.45,.14],[.53,.16],[.56,.23],[.52,.29],[.46,.28],[.40,.24]],
  [[.40,.28],[.51,.27],[.57,.36],[.56,.49],[.52,.62],[.47,.72],[.42,.62],[.38,.47],[.38,.35]],
  [[.51,.14],[.63,.08],[.76,.08],[.89,.14],[.98,.23],[.95,.33],[.87,.36],[.82,.44],[.73,.42],[.68,.37],[.60,.37],[.54,.30],[.51,.23]],
  [[.61,.34],[.68,.37],[.73,.47],[.80,.52],[.78,.59],[.71,.56],[.66,.49]],
  [[.70,.65],[.80,.60],[.90,.64],[.94,.74],[.87,.83],[.76,.81],[.69,.73]],
  [[.93,.40],[.96,.43],[.95,.50],[.92,.48]], [[.58,.69],[.60,.73],[.59,.80],[.57,.77]],
]
const COLORS = ['#ff2d55', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#af52de']
// Density matched to the approved screen's confetti field (~90 in flight).
const CONFETTI = Array.from({length:90},(_,i)=>({left:`${i*37%101}%`,delay:`${-(i%11)*.31}s`,duration:`${3.3+(i%7)*.24}s`,color:COLORS[i%COLORS.length],drift:`${i*19%92-46}px`}))

function inside(x:number,y:number,polygon:Array<[number,number]>) { let hit=false; for(let i=0,j=polygon.length-1;i<polygon.length;j=i,i+=1){const [xi,yi]=polygon[i],[xj,yj]=polygon[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/((yj-yi)||1e-6)+xi)hit=!hit}return hit }

export default function LoadingGlobe(){
  const dotsRef=useRef<HTMLCanvasElement>(null)
  const globeHostRef=useRef<HTMLDivElement>(null)
  const [performancePolicy,setPerformancePolicy]=useState(()=>PoplurPerformanceManager.snapshot)
  useEffect(()=>PoplurPerformanceManager.subscribe(setPerformancePolicy),[])

  // Real 3D clay globe — same model, framing, lighting and spin as the approved
  // screen. The renderer is disposed on unmount (the prototype does this on
  // pagehide) so mapbox-gl isn't starved of a WebGL context when Loading lifts.
  useEffect(()=>{
    const host=globeHostRef.current
    if(!host)return
    // The canvas is created per mount: freeing the context on unmount
    // (forceContextLoss) permanently kills THAT canvas, so a reused element
    // would come back dead on the next mount (React re-runs effects in dev).
    const canvas=document.createElement('canvas')
    canvas.className=styles.mapLoadingGlobeCanvas
    host.appendChild(canvas)
    const initialPolicy=PoplurPerformanceManager.policy
    let renderer:THREE.WebGLRenderer
    try{ renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:initialPolicy.mode==='FULL'}) }catch{ canvas.remove(); return }
    renderer.setPixelRatio(Math.min(devicePixelRatio,initialPolicy.maximumPixelRatio))
    renderer.outputColorSpace=THREE.SRGBColorSpace
    const scene=new THREE.Scene()
    const camera=new THREE.PerspectiveCamera(32,232/478,.01,50)
    camera.position.set(0,0,6)
    scene.add(new THREE.HemisphereLight(0xffffff,0x3a0f2a,2))
    const key=new THREE.DirectionalLight(0xffffff,2.8); key.position.set(3,4,5); scene.add(key)
    const fill=new THREE.DirectionalLight(0x9fd0ff,1.3); fill.position.set(-4,-1,2); scene.add(fill)

    const resize=()=>{
      const w=canvas.clientWidth||232,h=canvas.clientHeight||478
      renderer.setSize(w,h,false)
      camera.aspect=w/h
      camera.updateProjectionMatrix()
    }

    const loader=new GLTFLoader()
    let globe:THREE.Object3D|null=null
    let disposed=false
    const disposeObject=(object:THREE.Object3D)=>object.traverse(child=>{const mesh=child as THREE.Mesh;mesh.geometry?.dispose();const materials=Array.isArray(mesh.material)?mesh.material:mesh.material?[mesh.material]:[];materials.forEach(material=>{Object.values(material).forEach(value=>{if(value&&(value as THREE.Texture).isTexture)(value as THREE.Texture).dispose()});material.dispose()})})
    loader.load('poplur-globe-lite.glb',gltf=>{
      if(disposed){disposeObject(gltf.scene);return}
      globe=gltf.scene
      const box=new THREE.Box3().setFromObject(globe)
      const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3())
      globe.position.sub(center)
      globe.scale.setScalar(2.6/Math.max(size.x,size.y,size.z,.001))
      globe.position.y=.3
      scene.add(globe)
    })
    loader.load('poplur-wordmark-lite.glb',gltf=>{
      if(disposed){disposeObject(gltf.scene);return}
      const mark=gltf.scene
      const box=new THREE.Box3().setFromObject(mark)
      const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3())
      mark.position.sub(center)
      mark.scale.setScalar(.58/Math.max(size.x,size.y,.001))
      mark.position.set(0,-.05,2)
      scene.add(mark)
    })

    resize()
    const observer=new ResizeObserver(resize)
    observer.observe(canvas)
    let stopFrames:(()=>void)|null=null
    const tick=(dtMs:number)=>{if(globe)globe.rotation.y+=dtMs*.0009;renderer.render(scene,camera)}
    const performanceRenderer=PoplurPerformanceManager.registerRenderer({
      id:'LoadingGlobe3D',heavy:true,priority:100,
      onActiveChange:(active,policy)=>{
        renderer.setPixelRatio(Math.min(devicePixelRatio,policy.maximumPixelRatio));resize()
        if(active&&!stopFrames)stopFrames=onFrame(tick,'ambient')
        else if(!active&&stopFrames){stopFrames();stopFrames=null}
      },
    })
    return()=>{
      disposed=true
      performanceRenderer.dispose()
      stopFrames?.()
      observer.disconnect()
      disposeObject(scene)
      releaseWebGL(renderer)
      canvas.remove()
    }
  },[])

  useEffect(()=>{const canvas=dotsRef.current,context=canvas?.getContext('2d',{alpha:true});if(!canvas||!context)return;const reduced=matchMedia('(prefers-reduced-motion: reduce)');let width=0,height=0;let dots:Array<{x:number;y:number;r:number;p:number}>=[]
    const rebuild=()=>{const bounds=canvas.getBoundingClientRect();width=bounds.width||innerWidth;height=bounds.height||innerHeight;const ratio=Math.min(2,devicePixelRatio||1);canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);context.setTransform(ratio,0,0,ratio,0,0);const spacing=Math.max(6.5,Math.min(10,width/52));dots=[];let row=0;for(let y=spacing*.5;y<height;y+=spacing,row+=1){let column=0;for(let x=spacing*.5;x<width;x+=spacing,column+=1){if(!LAND.some((polygon)=>inside(x/width,.02+y/height*.96,polygon)))continue;const hash=Math.abs(row*73+column*151+row*column*19)%41;if(hash<11)dots.push({x,y,r:Math.max(1.55,spacing*.21),p:(hash*.77+row*.19+column*.31)%(Math.PI*2)})}}}
    const circle=(x:number,y:number,r:number,fill:string)=>{context.beginPath();context.arc(x,y,r,0,Math.PI*2);context.fillStyle=fill;context.fill()};const draw=(_dt:number,now:number)=>{context.clearRect(0,0,width,height);dots.forEach((dot)=>{const pulse=reduced.matches?.62:.5+.5*Math.sin(now/620+dot.p),radius=dot.r*(.86+pulse*.28);circle(dot.x,dot.y+1.3,radius,`rgba(8,28,110,${.3+pulse*.22})`);circle(dot.x,dot.y-.8,radius,`rgba(196,220,255,${.3+pulse*.34})`);circle(dot.x,dot.y,radius*.94,`rgba(116,166,255,${.5+pulse*.4})`);if(!reduced.matches&&pulse>.9)circle(dot.x,dot.y,radius*2.4,`rgba(255,255,255,${(pulse-.9)*1.6})`)})};const resize=()=>{rebuild();draw(0,performance.now())};const observer=new ResizeObserver(resize);observer.observe(canvas);resize();let stopFrames:(()=>void)|null=null;const sync=(snapshot:ReturnType<typeof getSnapshot>)=>{if(snapshot.decorativeRenderingAllowed&&!reduced.matches&&!stopFrames)stopFrames=onFrame(draw,'ambient');else if((!snapshot.decorativeRenderingAllowed||reduced.matches)&&stopFrames){stopFrames();stopFrames=null}};const getSnapshot=()=>PoplurPerformanceManager.snapshot;const stopPolicy=PoplurPerformanceManager.subscribe(sync);return()=>{stopPolicy();stopFrames?.();observer.disconnect()}},[])
  const confettiCount=Math.min(CONFETTI.length,Math.floor(CONFETTI.length*performancePolicy.particleDensityMultiplier))
  return <div className={styles.mapLoadingGlobeHost} aria-hidden="true"><canvas ref={dotsRef} className={styles.mapLoadingDots}/><div ref={globeHostRef} className={styles.mapLoadingGlobeLayer}/><div className={styles.mapLoadingConfetti}>{CONFETTI.slice(0,confettiCount).map((piece,index)=><span className={styles.mapLoadingConfettiPiece} key={index} style={{left:piece.left,background:piece.color,animationDelay:piece.delay,animationDuration:piece.duration,animationPlayState:performancePolicy.decorativeRenderingAllowed?'running':'paused','--drift':piece.drift} as React.CSSProperties}/>)}</div></div>
}
