// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VFXParticleSystem, { type VFXParticleEffect } from '../VFXParticleSystem'
import ClayCornerButton from '../ClayCornerButton'
import ClayMuteButton from '../ClayMuteButton'
import { modelSprite } from '../modelSprite'
import controls from '../sharedClayControls.json'
import VFXObjectPreview, { BAKED_VFX_OBJECTS } from '../VFXObjectPreview'

const runtime = vi.hoisted(() => ({ frames: new Set<(dt: number) => void>(), fallback: vi.fn(), disposals: 0 }))
vi.mock('../runtimeModelSprite', () => ({ renderModelSprite: runtime.fallback }))
vi.mock('../frameGovernor', () => ({ onFrame: (fn: (dt: number) => void) => { runtime.frames.add(fn); return () => runtime.frames.delete(fn) } }))
vi.mock('../poplurPerformanceManager', () => {
  const policy = { mode: 'FULL', particlesAllowed: true, decorativeRenderingAllowed: true, particleDensityMultiplier: 1, maxParticleObjects: 128, maximumPixelRatio: 1.5 }
  return { PoplurPerformanceManager: { policy, registerRenderer: ({ onActiveChange, demanded }: any) => {
    onActiveChange(demanded, policy)
    return { setDemand: (active: boolean) => onActiveChange(active, policy), dispose: () => { runtime.disposals++ } }
  } } }
})
let root: Root
let host: HTMLDivElement
let context: any
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  runtime.fallback.mockReset(); runtime.frames.clear(); runtime.disposals = 0
  const gradient = { addColorStop: vi.fn() }
  context = Object.fromEntries(['clearRect','fillRect','strokeRect','beginPath','moveTo','bezierCurveTo','closePath','fill','setTransform','save','translate','rotate','drawImage','restore'].map(name => [name, vi.fn()]))
  context.createLinearGradient = context.createRadialGradient = () => gradient
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((type: string) => {
    if (type !== '2d') throw new Error(`Unexpected rendering context: ${type}`)
    return context
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })
function frame() { act(() => { for (const callback of runtime.frames) callback(40) }) }

describe('additional 2D conversions', () => {
  it.each<VFXParticleEffect>(['explosion','fireworks','confetti','rain','fire'])('%s paints using only 2D, pauses when hidden, and releases its clock', effect => {
    act(() => root.render(<VFXParticleSystem effect={effect} intensity={100} speed={1} active />))
    expect(host.querySelectorAll('canvas')).toHaveLength(1)
    frame(); expect(context.drawImage).toHaveBeenCalled()
    const count = context.drawImage.mock.calls.length
    expect(count).toBeLessThanOrEqual(128)
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(runtime.frames.size).toBe(0)
    frame(); expect(context.drawImage).toHaveBeenCalledTimes(count)
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(runtime.frames.size).toBe(1)
    act(() => root.render(null))
    expect(runtime.frames.size).toBe(0)
    expect(runtime.disposals).toBe(1)
  })

  it('updates intensity without adding clocks and stops completely at zero', () => {
    const render = (intensity: number) => act(() => root.render(<VFXParticleSystem effect="rain" intensity={intensity} speed={1} active />))
    render(100); frame(); expect(context.drawImage).toHaveBeenCalledTimes(128)
    context.drawImage.mockClear(); render(10); frame()
    expect(context.drawImage).toHaveBeenCalledTimes(18)
    expect(runtime.frames.size).toBe(1)
    render(0); expect(host.querySelector('canvas')).toBeNull(); expect(runtime.frames.size).toBe(0)
  })

  it('keeps every clay control state visible with no canvas and single keyboard activation', () => {
    const press = vi.fn()
    for (const [key, src] of Object.entries(controls)) {
      expect(existsSync(resolve('public', src)), key).toBe(true)
      const [kind, active, tone] = key.split('|')
      act(() => root.render(kind === 'mute' ? <ClayMuteButton muted={active === 'true'} onToggle={press} />
        : <ClayCornerButton kind={kind as any} active={active === 'true'} tone={tone as any} label={kind} onPress={press} />))
      expect(host.querySelector('img')?.getAttribute('src')).toBe(src)
      expect(host.querySelector('canvas')).toBeNull()
      act(() => host.querySelector('button')!.click())
    }
    expect(press).toHaveBeenCalledTimes(Object.keys(controls).length)
    expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled()
  })

  it('renders every stock VFX overlay as artwork without loading model-viewer', () => {
    for (const [id, src] of Object.entries(BAKED_VFX_OBJECTS)) {
      expect(existsSync(resolve('public', src))).toBe(true)
      act(() => root.render(<VFXObjectPreview id={id} src="/not-to-be-loaded.glb" name={id} active fallbackSrc="/logo_icon.png" />))
      expect(host.querySelector('img')?.getAttribute('src')).toBe(`/${src}`)
      expect(host.querySelector('model-viewer')).toBeNull()
    }
    expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled()
  })

  it('serves all stock mini-app thumbnails without loading the model renderer', async () => {
    const icons = readFileSync(resolve('src/miniAppIcons.ts'), 'utf8')
    const models = new Set([...icons.matchAll(/model: '([^']+)'/g)].map(match => match[1]).concat('poplur_cube_create.glb'))
    for (const model of models) {
      const src = await modelSprite(model, { yaw: -18, pitch: 14, size: 256 })
      expect(existsSync(resolve('public', src)), model).toBe(true)
      expect(src).toMatch(/^sprites\/.+\.png$/)
    }
    expect(models.size).toBe(29)
    expect(runtime.fallback).not.toHaveBeenCalled()
  })
})
