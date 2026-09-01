import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { nativeFeedPostsToMapPins } from '../mapLivePosts'
import { normalizeNativeFeedPosts } from '../nativeFeedPosts'
import { profilePostsFromRealtime } from '../profileRealtimePosts'

const postId = 'post-first-user-proof-123456'
const emulatorURL = 'http://127.0.0.1:9199/v0/b/demo-poplur-first-user-v1.appspot.com/o/posts%2Fuser-first%2Fproof.jpg?alt=media'
const raw = {
  id: postId,
  ownerId: 'user-first',
  username: 'first.user',
  mediaURL: emulatorURL,
  mediaType: 'photo',
  channelId: 'live',
  radiusMeters: 5_000,
  createdAtMillis: 10,
  locationVisibility: 'approximate',
  originLatitude: 43.653,
  originLongitude: -79.383,
  syntheticJourney: 'first-user-v1',
}

describe('isolated first-user Map/Profile post proof', () => {
  it('keeps production HTTPS-only and admits only the tagged exact emulator origin', () => {
    expect(normalizeNativeFeedPosts({ posts: [raw] })).toEqual([])
    expect(normalizeNativeFeedPosts({
      posts: [{ ...raw, mediaURL: 'http://localhost:9199/not-exact.jpg' }],
    }, { allowSyntheticOnboarding: true })).toEqual([])
    expect(normalizeNativeFeedPosts({
      posts: [{ ...raw, syntheticJourney: undefined }],
    }, { allowSyntheticOnboarding: true })).toEqual([])

    expect(normalizeNativeFeedPosts(
      { posts: [raw] },
      { allowSyntheticOnboarding: true },
    )).toMatchObject([{ id: postId, mediaURL: emulatorURL, syntheticJourney: 'first-user-v1' }])
  })

  it('carries the identical bound post id into both Map and Profile projections', () => {
    const posts = normalizeNativeFeedPosts(
      { posts: [raw] },
      { allowSyntheticOnboarding: true },
    )
    const [mapPin] = nativeFeedPostsToMapPins(posts, 'user-first')
    const [profilePost] = profilePostsFromRealtime(posts, 'user-first', null)

    expect(mapPin).toMatchObject({
      id: `firestore:${postId}`,
      syntheticPostId: postId,
      mine: true,
      media: { kind: 'image', src: emulatorURL },
    })
    expect(profilePost).toMatchObject({
      id: postId,
      syntheticPostId: postId,
      video: emulatorURL,
    })
  })

  it('locks the visible Home-frame Map and Profile selector contract', () => {
    const home = readFileSync(new URL('../HomeTwin.tsx', import.meta.url), 'utf8')
    const profile = readFileSync(new URL('../ProfileTwin.tsx', import.meta.url), 'utf8')
    const map = readFileSync(new URL('../ClayMap.tsx', import.meta.url), 'utf8')
    const mapApp = readFileSync(new URL('../MapApp.tsx', import.meta.url), 'utf8')

    // RN 8081 dispatches into Home through the privileged bridge. Home and its
    // nested Map are both exact-origin 5173, so the second hop remains narrow.
    expect(home).toContain("type: 'poplur-native-map-posts'")
    expect(home).toContain('}, window.location.origin)')
    expect(mapApp).toContain('event.origin !== window.location.origin || event.source !== window.parent')
    expect(home).toContain("data-synthetic-post-surface={mapSyntheticPostId ? 'map' : undefined}")
    expect(home).toContain('data-synthetic-post-id={mapSyntheticPostId ?? undefined}')
    expect(profile).toContain("data-synthetic-post-surface={post.syntheticPostId ? 'profile' : undefined}")
    expect(profile).toContain('data-synthetic-post-id={post.syntheticPostId}')
    expect(map).toContain("type: 'poplur-map-synthetic-post-visible'")
    expect(map).toContain('postId: pin.syntheticPostId')
  })
})
