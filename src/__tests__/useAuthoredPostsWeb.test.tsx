// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useAuthoredPosts } from '../useAuthoredPosts'

const wire = vi.hoisted(() => ({ next: (_value: unknown) => {}, fail: () => {}, stop: vi.fn(), constraints: [] as unknown[] }))
vi.mock('../nativeBridge', () => ({ isNativeShell: () => false, postNativeEvent: vi.fn() }))
vi.mock('../webFirebase', () => ({ webDb: () => ({}) }))
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => path,
  where: (...args: unknown[]) => args,
  query: (...args: unknown[]) => { wire.constraints = args; return args },
  onSnapshot: (_query: unknown, _options: unknown, next: typeof wire.next, fail: typeof wire.fail) => {
    wire.next = next; wire.fail = fail; return wire.stop
  },
}))

it('does not call a partial Feed cache a complete author total, and keeps verified totals on a later error', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div'); const root = createRoot(host)
  const Screen = () => {
    const value = useAuthoredPosts('author')
    return <span>{value.snapshot?.totalRadiusKm ?? 'loading'}{value.error ? ' stale' : ''}</span>
  }
  const snapshot = (count: number, fromCache: boolean) => ({ metadata: { fromCache },
    docs: Array.from({ length: count }, (_, id) => ({ id: String(id), data: () => ({
      userID: 'author', radiusMeters: 1000, mediaURL: `https://example.test/${id}.jpg`,
    }) })) })
  try {
    await act(async () => root.render(<Screen />))
    expect(wire.constraints).toEqual(['posts', ['userID', '==', 'author']])
    await act(async () => wire.next(snapshot(96, true)))
    expect(host.textContent).toBe('loading')
    await act(async () => wire.next(snapshot(240, false)))
    expect(host.textContent).toBe('240')
    await act(async () => wire.fail())
    expect(host.textContent).toBe('240 stale')
  } finally {
    await act(async () => root.unmount())
    expect(wire.stop).toHaveBeenCalled()
  }
})
