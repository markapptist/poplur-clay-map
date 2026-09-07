// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import StationBootModel from '../StationBootModel'
import StationControllerModel from '../StationControllerModel'
import RadioBootScreen from '../RadioBootScreen'
vi.mock('../radioPowerSound', () => ({ playRadioPowerOn: vi.fn() }))
let root: Root
afterEach(() => { act(() => root?.unmount()); document.body.innerHTML = ''; vi.useRealTimers() })
describe('baked Radio and Station chrome', () => {
  it('uses shipped artwork without allocating rendering contexts and completes startup', () => {
    vi.useFakeTimers(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    const done = vi.fn()
    act(() => root.render(<><RadioBootScreen onDone={done} /><StationBootModel className="boot" /><StationControllerModel className="controller" /></>))
    expect(host.querySelectorAll('img')).toHaveLength(3)
    for (const img of host.querySelectorAll('img')) expect(existsSync(resolve(process.cwd(), 'public', img.getAttribute('src')!))).toBe(true)
    expect(host.querySelector('canvas')).toBeNull(); expect(context).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(2350)); expect(done).toHaveBeenCalledOnce()
    act(() => vi.advanceTimersByTime(10_000)); expect(done).toHaveBeenCalledOnce()
    context.mockRestore()
  })
})
