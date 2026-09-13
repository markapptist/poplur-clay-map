// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PostComposer from '../PostComposer'
import { postNativeEvent } from '../nativeBridge'
import ShellOverlayPortal, { mountShellOverlay } from '../ShellOverlayPortal'

vi.mock('../FeedTwin', () => {
  const channels = [{ id: 'food', number: 101, name: 'Food', icon: 'food' }]
  return { CHANNELS: channels, POSTABLE_CHANNELS: () => channels }
})
vi.mock('../VideoEditor', () => ({ default: () => null }))
vi.mock('../VFXStudio', () => ({ default: () => null }))
vi.mock('../ComposerAIChat', () => ({ default: () => null }))
vi.mock('../NotifConfetti', () => ({ default: () => null }))
vi.mock('../newsMessageDraft', () => ({ renderMessageCard: () => ({ kind: 'photo', src: 'data:image/jpeg;base64,fixture' }) }))
vi.mock('../newsMessages', () => ({ dropNewsMessage: vi.fn() }))
vi.mock('../nativeBridge', async importOriginal => ({ ...await importOriginal<typeof import('../nativeBridge')>(), isNativeShell: () => true, postNativeEvent: vi.fn() }))
vi.mock('../pop', () => ({ playPop: vi.fn() }))
vi.mock('../analytics', () => ({ track: vi.fn() }))
vi.mock('../useClaimRadiusLimit', () => ({ useClaimRadiusLimitKm: () => 100 }))

let root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers()
  vi.clearAllMocks()
  const element = document.createElement('main')
  document.body.appendChild(element)
  root = createRoot(element)
})
afterEach(() => {
  act(() => root.unmount())
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('upload stage ownership', () => {
  it.each([
    { kind: 'photo' as const, messageCard: true },
    { kind: 'photo' as const, messageCard: false },
    { kind: 'video' as const, messageCard: false },
  ])('publishes $kind Pop Messages with explicit classification (text card=$messageCard)', async ({ kind, messageCard }) => {
    act(() => root.render(<PostComposer
      media={{ kind, src: `data:${kind === 'photo' ? 'image/jpeg' : 'video/mp4'};base64,fixture` }}
      target={{ lat: 43, lng: -79, radiusKm: 5 }}
      draft={{ caption: 'Hello #Toronto', channelId: 'food', filterId: 'none', usedAI: false, rightsAttested: true, newsMessage: true, messageCard }}
      onClose={vi.fn()} />))
    const submit = [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Post message to map'))!
    expect(submit).toBeDefined()
    await act(async () => submit.click())
    const requests = vi.mocked(postNativeEvent).mock.calls.map(([data]) => data).filter(data => data.type === 'publishPost')
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ contentType: 'message', messageCard, kind, caption: 'Hello #Toronto', radiusKm: 5 })
    // Finish the mocked request; this never reaches a real native account.
    await act(async () => window.dispatchEvent(new CustomEvent('poplur-upload-result', { detail: { requestId: requests[0].requestId, ok: true } })))
  })

  it('replaces the form, waits through 100% transfer, then shows only verified completion', async () => {
    const onPosted = vi.fn()
    const onClose = vi.fn()
    let back: (() => void) | null = null
    act(() => root.render(<PostComposer
      media={{ kind: 'photo', src: 'data:image/jpeg;base64,fixture' }}
      target={{ lat: 43, lng: -79, radiusKm: 5 }}
      draft={{ caption: 'Keep my caption', channelId: 'food', filterId: 'none', usedAI: false, rightsAttested: true }}
      onClose={onClose} onPosted={onPosted} bindBack={fn => { back = fn }}
    />))
    const post = Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('Post to News Feed'))!
    expect(post).toBeDefined()
    await act(async () => { post.click(); post.click() })
    const requests = vi.mocked(postNativeEvent).mock.calls.map(([data]) => data).filter(data => data.type === 'publishPost')
    expect(requests).toHaveLength(1)
    expect(document.querySelector('[aria-label="Post composer"]')).toBeNull()
    expect(document.querySelector('textarea')).toBeNull()
    expect(document.querySelector('[aria-label="Post upload progress"]')).not.toBeNull()
    act(() => back?.())
    expect(onClose).not.toHaveBeenCalled()
    const requestId = requests[0].requestId
    act(() => window.dispatchEvent(new CustomEvent('poplur-upload-progress', { detail: { requestId, fraction: 1 } })))
    expect(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('100')
    expect(onPosted).not.toHaveBeenCalled()
    expect(document.querySelector('[aria-label="Posted confirmation"]')).toBeNull()
    await act(async () => window.dispatchEvent(new CustomEvent('poplur-upload-result', { detail: { requestId, ok: true } })))
    expect(onPosted).toHaveBeenCalledOnce()
    expect(document.querySelector('[aria-label="Post upload progress"]')).toBeNull()
    expect(document.querySelector('[aria-label="Posted confirmation"]')).not.toBeNull()
    expect(document.querySelector('textarea')).toBeNull()
    act(() => root.unmount())
    root = createRoot(document.createElement('div'))
    act(() => vi.advanceTimersByTime(6000))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('restores the same draft after an upload failure and removes the full-screen overlay', async () => {
    act(() => root.render(<PostComposer
      media={{ kind: 'photo', src: 'data:image/jpeg;base64,fixture' }}
      target={{ lat: 43, lng: -79, radiusKm: 5 }}
      draft={{ caption: 'Preserve this draft', channelId: 'food', filterId: 'none', usedAI: false, rightsAttested: true }}
      onClose={vi.fn()}
    />))
    await act(async () => Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('Post to News Feed'))!.click())
    const request = vi.mocked(postNativeEvent).mock.calls.map(([data]) => data).find(data => data.type === 'publishPost')!
    await act(async () => window.dispatchEvent(new CustomEvent('poplur-upload-result', { detail: { requestId: request.requestId, ok: false, error: 'Connection lost' } })))
    expect(document.querySelector('[data-poplur-shell-overlay]')).toBeNull()
    expect(document.querySelector('textarea')?.value).toBe('Preserve this draft')
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Connection lost')
  })
})

describe('map dialog lifetime', () => {
  it('removes a parent-owned dialog when its iframe is replaced without a React unmount', async () => {
    vi.useRealTimers()
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    const overlay = mountShellOverlay(frame.contentWindow!)
    expect(document.querySelectorAll('[data-poplur-shell-overlay]')).toHaveLength(1)
    frame.remove()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(overlay.host.isConnected).toBe(false)
    expect(document.querySelectorAll('[data-poplur-shell-overlay]')).toHaveLength(0)
    overlay.dispose()
  })
  it('cleans up both page navigation and ordinary React unmount', () => {
    act(() => root.render(<ShellOverlayPortal><div role="dialog">Choose this spot</div></ShellOverlayPortal>))
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    act(() => window.dispatchEvent(new Event('pagehide')))
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0)
    act(() => root.render(null))
    expect(document.querySelectorAll('[data-poplur-shell-overlay]')).toHaveLength(0)
  })
})
