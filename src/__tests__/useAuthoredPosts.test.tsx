// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuthoredPosts, AUTHORED_POSTS_EVENT } from '../useAuthoredPosts'

const native = vi.hoisted(() => ({ messages: [] as Record<string, unknown>[] }))
vi.mock('../nativeBridge', () => ({ isNativeShell: () => true, postNativeEvent: (message: Record<string, unknown>) => { native.messages.push(message); return true } }))
const response = (request: Record<string, unknown>, radius = 1000) => new CustomEvent(AUTHORED_POSTS_EVENT, { detail: {
  subscriptionId: request.subscriptionId, uid: request.userId,
  documents: [{ id: 'post', row: { userID: request.userId, radiusMeters: radius, mediaURL: 'https://example.test/a.jpg' } }],
} })
afterEach(() => { vi.restoreAllMocks(); native.messages.length = 0 })

describe('author listener lifecycle', () => {
  it('discards previous-profile replies, parks in background, resumes, and removes its listener', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const Screen = ({ uid }: { uid: string }) => {
      const state = useAuthoredPosts(uid)
      return <span>{state.snapshot?.totalRadiusKm ?? 'loading'}</span>
    }
    try {
      await act(async () => root.render(<Screen uid="alice" />))
      const alice = native.messages[native.messages.length - 1]!
      await act(async () => window.dispatchEvent(response(alice, 2500)))
      expect(host.textContent).toBe('2.5')
      await act(async () => root.render(<Screen uid="bob" />))
      const bob = native.messages[native.messages.length - 1]!
      expect(host.textContent).toBe('loading')
      expect(native.messages).toContainEqual({ type: 'stopAuthoredPosts', subscriptionId: alice.subscriptionId })
      await act(async () => window.dispatchEvent(response(alice, 999000)))
      expect(host.textContent).toBe('loading')
      await act(async () => window.dispatchEvent(response(bob, 500)))
      expect(host.textContent).toBe('0.5')
      await act(async () => window.dispatchEvent(new CustomEvent('poplur-native-app-lifecycle', { detail: { active: false } })))
      expect(native.messages[native.messages.length - 1]?.type).toBe('stopAuthoredPosts')
      await act(async () => window.dispatchEvent(new CustomEvent('poplur-native-app-lifecycle', { detail: { active: true } })))
      const resumed = native.messages[native.messages.length - 1]!
      expect(resumed.type).toBe('watchAuthoredPosts')
      expect(resumed.subscriptionId).not.toBe(bob.subscriptionId)
      await act(async () => window.dispatchEvent(response(bob, 9000)))
      expect(host.textContent).toBe('0.5')
      await act(async () => window.dispatchEvent(response(resumed, 750)))
      expect(host.textContent).toBe('0.75')
      await act(async () => root.unmount())
      expect(native.messages[native.messages.length - 1]).toEqual({ type: 'stopAuthoredPosts', subscriptionId: resumed.subscriptionId })
    } finally { if (host.childNodes.length) await act(async () => root.unmount()); host.remove() }
  })
  it('does not subscribe until the landmark page is visible', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const host = document.createElement('div'); const root = createRoot(host)
    const Screen = ({ enabled }: { enabled: boolean }) => { useAuthoredPosts('me', enabled); return null }
    try {
      await act(async () => root.render(<Screen enabled={false} />))
      expect(native.messages).toEqual([])
      await act(async () => root.render(<Screen enabled />))
      expect(native.messages[native.messages.length - 1]?.type).toBe('watchAuthoredPosts')
      await act(async () => root.render(<Screen enabled={false} />))
      expect(native.messages[native.messages.length - 1]?.type).toBe('stopAuthoredPosts')
    } finally { await act(async () => root.unmount()) }
  })
})
