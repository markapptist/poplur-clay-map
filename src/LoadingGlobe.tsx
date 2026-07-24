import React, { useEffect, useRef } from 'react'
import styles from './HomeTwin.module.css'

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
const CONFETTI = Array.from({length:30},(_,i)=>({left:`${i*37%101}%`,delay:`${-(i%11)*.31}s`,duration:`${3.3+(i%7)*.24}s`,color:COLORS[i%COLORS.length],drift:`${i*19%92-46}px`}))

function inside(x:number,y:number,polygon:Array<[number,number]>) { let hit=false; for(let i=0,j=polygon.length-1;i<polygon.length;j=i,i+=1){const [xi,yi]=polygon[i],[xj,yj]=polygon[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/((yj-yi)||1e-6)+xi)hit=!hit}return hit }

export default function LoadingGlobe(){
  const dotsRef=useRef<HTMLCanvasElement>(null)
  useEffect(()=>{const canvas=dotsRef.current,context=canvas?.getContext('2d',{alpha:true});if(!canvas||!context)return;const reduced=matchMedia('(prefers-reduced-motion: reduce)');let width=0,height=0,raf=0;let dots:Array<{x:number;y:number;r:number;p:number}>=[]
    const rebuild=()=>{const bounds=canvas.getBoundingClientRect();width=bounds.width||innerWidth;height=bounds.height||innerHeight;const ratio=Math.min(2,devicePixelRatio||1);canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);context.setTransform(ratio,0,0,ratio,0,0);const spacing=Math.max(6.5,Math.min(10,width/52));dots=[];let row=0;for(let y=spacing*.5;y<height;y+=spacing,row+=1){let column=0;for(let x=spacing*.5;x<width;x+=spacing,column+=1){if(!LAND.some((polygon)=>inside(x/width,.02+y/height*.96,polygon)))continue;const hash=Math.abs(row*73+column*151+row*column*19)%41;if(hash<11)dots.push({x,y,r:Math.max(1.55,spacing*.21),p:(hash*.77+row*.19+column*.31)%(Math.PI*2)})}}}
    const circle=(x:number,y:number,r:number,fill:string)=>{context.beginPath();context.arc(x,y,r,0,Math.PI*2);context.fillStyle=fill;context.fill()};const draw=(now:number)=>{context.clearRect(0,0,width,height);dots.forEach((dot)=>{const pulse=reduced.matches?.62:.5+.5*Math.sin(now/620+dot.p),radius=dot.r*(.86+pulse*.28);circle(dot.x,dot.y+1.3,radius,`rgba(8,28,110,${.3+pulse*.22})`);circle(dot.x,dot.y-.8,radius,`rgba(196,220,255,${.3+pulse*.34})`);circle(dot.x,dot.y,radius*.94,`rgba(116,166,255,${.5+pulse*.4})`);if(!reduced.matches&&pulse>.9)circle(dot.x,dot.y,radius*2.4,`rgba(255,255,255,${(pulse-.9)*1.6})`)});if(!reduced.matches)raf=requestAnimationFrame(draw)};const resize=()=>{rebuild();cancelAnimationFrame(raf);draw(performance.now())};const observer=new ResizeObserver(resize);observer.observe(canvas);resize();return()=>{cancelAnimationFrame(raf);observer.disconnect()}},[])
  return <div className={styles.mapLoadingGlobeHost} aria-hidden="true"><canvas ref={dotsRef} className={styles.mapLoadingDots}/><div className={styles.mapLoadingClayGlobe}><span className={styles.mapLoadingGlobeGrid}/><img src="/logo_icon.png" alt=""/></div><div className={styles.mapLoadingConfetti}>{CONFETTI.map((piece,index)=><span className={styles.mapLoadingConfettiPiece} key={index} style={{left:piece.left,background:piece.color,animationDelay:piece.delay,animationDuration:piece.duration,'--drift':piece.drift} as React.CSSProperties}/>)}</div></div>
}
