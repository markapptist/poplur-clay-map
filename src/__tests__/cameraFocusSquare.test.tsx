// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import CameraFocusSquare from '../CameraFocusSquare'
import type { Detection } from '../mlDetect'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const object: Detection = { id: 'tv', label: 'tv', confidence: 0.9, x: 0.1, y: 0.2, w: 0.8, h: 0.7 }

describe('the original camera square', () => {
  it('changes colour in place, shows matched identity, and retires stale actions', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const onPress = vi.fn()
    const render = (detection: Detection | null) => act(() => root.render(
      <CameraFocusSquare detection={detection} point={null} onPress={onPress} />,
    ))
    render(object)
    const button = host.querySelector('button')!
    expect(button.dataset.focusLock).toBe('object')
    expect(host.querySelectorAll('button')).toHaveLength(1)
    expect(button.style.width).toBe('') // never takes the detector's rectangular bounds
    expect(button.style.left).toBe('50%')
    act(() => button.click())
    expect(onPress).toHaveBeenLastCalledWith(object)
    const user = { ...object, id: 'user', user: { handle: '@mark', name: 'Mark', radiusKm: 177.3 } }
    render(user)
    expect(host.querySelector('button')).toBe(button)
    expect(button.dataset.focusLock).toBe('user')
    expect(button.textContent).toContain('Mark')
    expect(button.textContent).toMatch(/177.3|110.2/)
    act(() => button.click())
    expect(onPress).toHaveBeenLastCalledWith(user)
    render(null)
    expect(host.querySelector('button')).toBeNull()
    act(() => root.unmount())
    host.remove()
  })
})
