import { describe, expect, it } from 'vitest'
import { normalizeLiveMapDocuments, normalizeLiveMapPost } from '../mapLivePosts'
import { mapPinRenderKey, pinMarkerNeedsRebuild } from '../mapPinRenderKey'
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

  it('changes marker identity when what the marker DRAWS changes', () => {
    const base = normalizeLiveMapPost('post-1', publicPost)
    expect(base).not.toBeNull()
    if (!base) return
    const key = mapPinRenderKey(base)
    expect(mapPinRenderKey({ ...base, coords: [-79.4, 43.7] })).not.toBe(key)
    expect(mapPinRenderKey({ ...base, name: 'New place' })).not.toBe(key)
    expect(mapPinRenderKey({ ...base, color: '#123456' })).not.toBe(key)
    expect(mapPinRenderKey({ ...base, avatar: 'https://cdn.example/face.png' })).not.toBe(key)
    expect(mapPinRenderKey({ ...base, radiusKm: base.radiusKm + 1 })).not.toBe(key)
    expect(mapPinRenderKey({ ...base, radiusDeltaKm: 2 })).not.toBe(key)
    expect(mapPinRenderKey({ ...base, ghost: true })).not.toBe(key)
  })

  it('holds a marker through a change it does not draw', () => {
    // The card payload is NOT marker identity. Counters tick on every view and
    // like inside the cohort's radius; when they were in this key, one tick
    // removed and recreated every mounted marker for a board that looked
    // exactly the same (measured 5 Sep: ten remove+create per counter tick).
    // ClayMap resolves the live pin by id when the pin is clicked, so the card
    // still opens on current numbers — see `pinsListRef` in the click handler.
    const base = normalizeLiveMapPost('post-1', publicPost)
    expect(base).not.toBeNull()
    if (!base) return
    const key = mapPinRenderKey(base)
    expect(mapPinRenderKey({ ...base, channel: 'news' })).toBe(key)
    expect(mapPinRenderKey({
      ...base,
      media: { kind: 'video', src: 'https://cdn.example/changed.mp4', alt: 'Changed' },
    })).toBe(key)
    expect(mapPinRenderKey({
      ...base,
      engagement: { ...(base.engagement ?? {}), views: (base.engagement?.views ?? 0) + 12 },
    })).toBe(key)

    const clayMap = readFileSync(new URL('../ClayMap.tsx', import.meta.url), 'utf8')
    // The click reads the board as it stands, not the pin captured at build.
    expect(clayMap).toContain('onPinOpenRef.current?.(pinsListRef.current.find(candidate => candidate.id === pin.id) ?? pin)')
    // And the effect reconciles against mounted markers instead of opening
    // with a full teardown.
    expect(clayMap).toContain('const livePins = pinRegistryRef.current')
    expect(clayMap).not.toMatch(/pinMarkersRef\.current\.forEach\(m => m\.remove\(\)\)\s*\n\s*pinMarkersRef\.current = \[\]\s*\n\s*if \(radiusPreviewLaunch\) return/)
  })

  it('retires a mounted marker only when what it draws has changed', () => {
    // The reconcile the pin effect runs: a marker is a DOM subtree with a
    // composited sprite, so it is torn down for a change the eye can see and
    // kept for one it cannot. Before this, ANY change to ANY pop rebuilt every
    // mounted marker on the board.
    const base = normalizeLiveMapPost('post-1', publicPost)
    expect(base).not.toBeNull()
    if (!base) return
    const held = mapPinRenderKey(base)

    // Drawn — rebuild.
    expect(pinMarkerNeedsRebuild(held, { ...base, radiusKm: base.radiusKm + 1 })).toBe(true)
    expect(pinMarkerNeedsRebuild(held, { ...base, coords: [-79.4, 43.7] })).toBe(true)
    expect(pinMarkerNeedsRebuild(held, { ...base, color: '#0f0f0f' })).toBe(true)
    expect(pinMarkerNeedsRebuild(held, { ...base, ghost: true })).toBe(true)
    expect(pinMarkerNeedsRebuild(held, { ...base, radiusDeltaKm: -3 })).toBe(true)

    // Not drawn — keep the marker that is already standing there.
    expect(pinMarkerNeedsRebuild(held, { ...base, channel: 'news' })).toBe(false)
    expect(pinMarkerNeedsRebuild(held, {
      ...base,
      engagement: { ...(base.engagement ?? {}), views: (base.engagement?.views ?? 0) + 40 },
    })).toBe(false)
    expect(pinMarkerNeedsRebuild(held, base)).toBe(false)

    // And the effect asks this question per pop rather than rebuilding the board.
    const clayMap = readFileSync(new URL('../ClayMap.tsx', import.meta.url), 'utf8')
    expect(clayMap).toContain('if (held && pinMarkerNeedsRebuild(held.key, pin)) {')
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
