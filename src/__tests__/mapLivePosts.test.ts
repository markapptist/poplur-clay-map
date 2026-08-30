import { describe, expect, it } from 'vitest'
import { normalizeLiveMapDocuments, normalizeLiveMapPost } from '../mapLivePosts'
import { mapPinRenderKey } from '../mapPinRenderKey'
import { readFileSync } from 'node:fs'

describe('live Firestore Map posts', () => {
  const publicPost = {
    userID: 'user-42',
    username: 'mapmaker',
    latitude: 43.653,
    longitude: -79.383,
    radiusMeters: 2_500,
    locationVisibility: 'approximate',
    audience: 'public',
    status: 'published',
    mediaURL: 'https://cdn.example/post.jpg',
    mediaType: 'photo',
    createdAtMillis: 1_777_000_000_000,
    viewCount: 12,
  }

  it('normalizes a public approximate post into one real Map pin', () => {
    expect(normalizeLiveMapPost('post-1', publicPost)).toMatchObject({
      id: 'firestore:post-1',
      ownerId: 'user-42',
      user: '@mapmaker',
      coords: [-79.383, 43.653],
      radiusKm: 2.5,
      source: 'firestore',
      media: { kind: 'image', src: 'https://cdn.example/post.jpg' },
      engagement: { views: 12 },
      mine: false,
    })
  })

  it('marks the signed-in account without exposing its handle as another user', () => {
    expect(normalizeLiveMapPost('mine', publicPost, 'user-42')).toMatchObject({
      user: null,
      mine: true,
    })
  })

  it.each([
    ['hidden origin', { locationVisibility: 'hidden' }],
    ['missing visibility', { locationVisibility: undefined }],
    ['private audience', { audience: 'private' }],
    ['private account', { privateAccount: true }],
    ['ghost mode', { ghostMode: true }],
    ['deleted status', { status: 'deleted' }],
    ['bad latitude', { latitude: 91 }],
    ['missing owner', { userID: undefined }],
  ])('rejects %s rather than putting it on the Map', (_label, patch) => {
    expect(normalizeLiveMapPost('blocked', { ...publicPost, ...patch })).toBeNull()
  })

  it('rejects unsafe media URLs while retaining the public marker', () => {
    const pin = normalizeLiveMapPost('safe', {
      ...publicPost,
      mediaURL: 'javascript:alert(1)',
      posterURL: 'data:image/png;base64,abc',
    })
    expect(pin).not.toBeNull()
    expect(pin?.media).toBeUndefined()
  })

  it('replaces state from complete realtime snapshots for add, change, and delete', () => {
    const document = (id: string, row: Record<string, unknown>) => ({
      id,
      data: () => row,
    })
    expect(normalizeLiveMapDocuments([])).toEqual([])

    const added = normalizeLiveMapDocuments([document('post-1', publicPost)])
    expect(added).toHaveLength(1)
    expect(added[0]?.coords).toEqual([-79.383, 43.653])

    const changed = normalizeLiveMapDocuments([document('post-1', {
      ...publicPost,
      latitude: 43.7,
      longitude: -79.4,
    })])
    expect(changed).toHaveLength(1)
    expect(changed[0]?.coords).toEqual([-79.4, 43.7])

    expect(normalizeLiveMapDocuments([])).toEqual([])
  })

  it('changes marker identity whenever its position or popup payload changes', () => {
    const base = normalizeLiveMapPost('post-1', publicPost)
    expect(base).not.toBeNull()
    if (!base) return
    const key = mapPinRenderKey(base)
    expect(mapPinRenderKey({ ...base, coords: [-79.4, 43.7] })).not.toBe(key)
    expect(mapPinRenderKey({ ...base, name: 'New place' })).not.toBe(key)
    expect(mapPinRenderKey({ ...base, channel: 'news' })).not.toBe(key)
    expect(mapPinRenderKey({
      ...base,
      media: { kind: 'video', src: 'https://cdn.example/changed.mp4', alt: 'Changed' },
    })).not.toBe(key)
  })

  it('keeps production Map rendering on the realtime database boundary', () => {
    const mapApp = readFileSync(new URL('../MapApp.tsx', import.meta.url), 'utf8')
    expect(mapApp).toContain('subscribeLiveMapPosts(')
    expect(mapApp).toContain('pois={NO_USER_POIS}')
    expect(mapApp).not.toMatch(/import\s+\{[^}]*\b(?:POIS|OTHER_POPS)\b[^}]*\}\s+from\s+'\.\/data'/s)
    expect(mapApp).not.toContain('setPublishedPins(')
    expect(mapApp).toContain('if (event.data.replay === true) break')
    expect(mapApp).toContain('const TAKEOVER_TEST = import.meta.env.DEV')
    const clayMap = readFileSync(new URL('../ClayMap.tsx', import.meta.url), 'utf8')
    expect(clayMap).toContain('const prototypeClaimSeeds = import.meta.env.DEV')
    expect(clayMap).not.toContain('setClaim(map, { id: dropped.id')
  })
})
