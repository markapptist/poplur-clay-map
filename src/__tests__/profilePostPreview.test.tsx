// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import ProfilePostPreview from '../ProfilePostPreview'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

it('settles a cached poster once and retires its static overlay without rechecking on parent renders', async () => {
  vi.useFakeTimers()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const complete = vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
  const host = document.createElement('div'); const root = createRoot(host)
  try {
    await act(async () => root.render(<ProfilePostPreview src="/cached.webp" />))
    expect(host.querySelector('img')?.className).toContain('tilePreviewReady')
    const checks = complete.mock.calls.length
    for (let i = 0; i < 60; i++) {
      await act(async () => root.render(<ProfilePostPreview src="/cached.webp" />))
    }
    expect(complete.mock.calls.length).toBe(checks)
    await act(async () => vi.advanceTimersByTime(620))
    expect(host.querySelector('span')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)

    complete.mockReturnValue(false)
    await act(async () => root.render(<ProfilePostPreview src="/replacement.webp" />))
    expect(host.querySelector('img')?.className).not.toContain('tilePreviewReady')
    expect(host.querySelector('span')).not.toBeNull()
    await act(async () => host.querySelector('img')!.dispatchEvent(new Event('error')))
    await act(async () => vi.advanceTimersByTime(620))
    expect(host.querySelector('span')).toBeNull()
  } finally {
    await act(async () => root.unmount())
  }
})
