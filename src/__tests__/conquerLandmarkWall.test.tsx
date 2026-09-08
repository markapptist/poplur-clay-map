// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import ConquerScreen from '../ConquerScreen'
import { authoredPostsSnapshot, type AuthoredPostsSnapshot } from '../authoredPosts'
import { CONQUER_LANDMARKS } from '../landmarkConquest'
import manifest from '../conquerLandmarkManifest.json'

const store = vi.hoisted(() => ({ snapshot: null as AuthoredPostsSnapshot | null, enabled: false }))
vi.mock('../accountStore', () => ({ accountSnapshot: () => ({ uid: 'me' }), onAccountChange: () => () => {} }))
vi.mock('../useAuthoredPosts', () => ({ useAuthoredPosts: (_uid: string, enabled: boolean) => {
  store.enabled = enabled
  return { snapshot: store.snapshot, loading: !store.snapshot, error: false, retry: () => {} }
} }))
afterEach(() => { vi.restoreAllMocks(); store.snapshot = null; store.enabled = false })

it('paginates into the wall, fills covered GLB silhouettes, and relocks on a live shrink', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  store.snapshot = authoredPostsSnapshot('me', [{ id: 'tower', row: {
    userID: 'me', radiusMeters: 50, latitude: 43.6426, longitude: -79.3871, locationVisibility: 'approximate',
  } }])
  try {
    await act(async () => root.render(<ConquerScreen snapshot={null} onClose={() => {}} />))
    expect(store.enabled).toBe(false)
    expect(host.querySelectorAll('[data-landmark]')).toHaveLength(0)
    await act(async () => (host.querySelector('[aria-label="Next Conquer Board page"]') as HTMLButtonElement).click())
    expect(store.enabled).toBe(true)
    expect(host.querySelector('[aria-current="page"]')?.textContent).toContain('Landmarks')
    expect(host.querySelectorAll('[data-landmark]')).toHaveLength(13)
    expect(host.querySelector('[data-landmark="cn-tower"]')?.getAttribute('data-covered')).toBe('true')
    expect(host.querySelector('[data-landmark="eiffel"]')?.getAttribute('data-covered')).toBe('false')
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('1')
    expect(host.querySelectorAll('canvas,model-viewer')).toHaveLength(0)
    store.snapshot = authoredPostsSnapshot('me', [])
    await act(async () => root.render(<ConquerScreen snapshot={null} onClose={() => {}} />))
    expect(host.querySelector('[data-landmark="cn-tower"]')?.getAttribute('data-covered')).toBe('false')
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('0')
    await act(async () => (host.querySelector('[aria-label="Previous Conquer Board page"]') as HTMLButtonElement).click())
    expect(store.enabled).toBe(false)
    expect(host.querySelector('[aria-current="page"]')?.textContent).toContain('Rankings')
  } finally { await act(async () => root.unmount()); host.remove() }
})

it('uses verified renders of every shipped landmark GLB, including Rogers Centre', () => {
  const hash = (path: string) => createHash('sha256').update(readFileSync(resolve('public', path))).digest('hex')
  expect(Object.keys(manifest.icons).sort()).toEqual(CONQUER_LANDMARKS.map(landmark => landmark.id).sort())
  for (const landmark of CONQUER_LANDMARKS) {
    const icon = manifest.icons[landmark.id]
    expect(icon.image).toBe(landmark.image)
    expect(hash(icon.glb), `${landmark.id} GLB`).toBe(icon.glbSha256)
    expect(hash(icon.image), `${landmark.id} image`).toBe(icon.imageSha256)
  }
})
