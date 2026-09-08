import React from 'react'
import { createRoot } from 'react-dom/client'
import VFXParticleSystem, { type VFXParticleEffect } from '../../src/VFXParticleSystem'
import ClayCornerButton from '../../src/ClayCornerButton'
import sprites from '../../src/spritePrerender.json'
import { PoplurPerformanceManager } from '../../src/poplurPerformanceManager'
import SpriteNavigator from '../../src/SpriteNavigator'

const host = document.createElement('div'); document.body.append(host)
const root = createRoot(host)
document.body.style.cssText = 'margin:0;background:#f7eee8;font-family:system-ui;color:#251321'
const card = { borderRadius: 28, background: '#fffbf9', padding: 14, textAlign: 'center' as const }
export function show(mode: string) {
  if (mode === 'objects') root.render(<main style={{ padding: 22 }}><h1>VFX · baked Poplur objects</h1><section style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>{['globe','camera','tv','mic','plane','pin'].map(name => <article key={name} style={card}><img src={`/vfx-sprites/${name}.png`} style={{ width: '100%', height: 250, objectFit: 'contain' }} /><h2>{name}</h2></article>)}</section></main>)
  else if (mode === 'apps') root.render(<main style={{ padding: 22 }}><h1>Mini-apps · baked clay icons</h1><section style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 10 }}>{Object.entries(sprites).filter(([key]) => key.endsWith('|-18|14|256')).map(([key,src]) => <article key={key} style={card}><img src={`/${src}`} style={{ width: 108, height: 108 }} /><div style={{ fontSize: 12 }}>{key.split('|')[0].replace('poplur_', '').replace('.glb','')}</div></article>)}</section></main>)
  else if (mode === 'controls') root.render(<main style={{ padding: 22 }}><h1>Clay controls · 2D artwork</h1><section style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>{['flash','close','share','send','capture','heart','comments','play','delete','block'].map(kind => <ClayCornerButton key={kind} kind={kind as any} label={kind} size={80} onPress={() => {}} />)}</section></main>)
  else root.render(<main style={{ padding: 22 }}><h1>VFX · 2D particle previews</h1><section style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>{(['explosion','fireworks','confetti','rain','fire'] as VFXParticleEffect[]).map(effect => <article key={effect}><h2>{effect}</h2><div style={{ position: 'relative', height: 270, borderRadius: 24, overflow: 'hidden', background: 'linear-gradient(#241633,#121523)' }}><VFXParticleSystem effect={effect} intensity={100} speed={1} active /></div></article>)}</section></main>)
}
export function stop() { root.render(null) }
export function snapshot() { return PoplurPerformanceManager.snapshot }
export function showNavigator(modelUrl: string, diceRollFace?: 1 | 2 | 3 | 4 | 5 | 6) {
  root.render(<main style={{padding:22}}><h1>Navigator tilt</h1><SpriteNavigator modelUrl={modelUrl} targetTab="profile" size={240}
    diceRollFace={diceRollFace} onTap={() => {}} onHold={() => {}} onFaceChange={() => {}} /></main>)
}

export function showParticle(effect: VFXParticleEffect, Component = VFXParticleSystem) {
  root.render(<main style={{padding:22}}><h1>{effect} · preview</h1><div style={{position:'relative',width:349,height:500,borderRadius:28,overflow:'hidden',background:'linear-gradient(#241633,#121523)'}}><Component effect={effect} intensity={100} speed={1} active /></div></main>)
}
