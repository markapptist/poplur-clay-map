import { describe, expect, it } from 'vitest'
import { authoredPostsSnapshot } from '../authoredPosts'
import { profilePostsForMode, profilePostsFromRealtime } from '../profileRealtimePosts'

const base = { userID: 'author', username: 'mark', mediaURL: 'https://example.com/photo.jpg', mediaType: 'photo', radius: 5000, audience: 'public', status: 'published', locationVisibility: 'approximate', latitude: 43, longitude: -79 }
const documents = [
  { id: 'card', row: { ...base, caption: 'Hello #Toronto', contentType: 'message', messageCard: true, createdAtMillis: 30 } },
  { id: 'video-message', row: { ...base, caption: 'With a video', contentType: 'message', mediaType: 'video', mediaURL: 'https://example.com/video.mp4', createdAtMillis: 20 } },
  { id: 'photo-message', row: { ...base, caption: 'With a photo', contentType: 'message', createdAtMillis: 15 } },
  { id: 'ordinary', row: { ...base, caption: 'A normal photo caption', createdAtMillis: 10 } },
]

describe('published Pop Message profile classification', () => {
  it('keeps text-only and attached messages out of Media, without treating captions as messages', () => {
    const snapshot = authoredPostsSnapshot('author', documents)
    const posts = profilePostsFromRealtime(snapshot.posts, 'author', null)
    expect(profilePostsForMode(posts, 'media').map(p => p.id)).toEqual(['ordinary'])
    expect(profilePostsForMode(posts, 'messages').map(p => p.id)).toEqual(['card', 'video-message', 'photo-message'])
    expect(posts[0]).toMatchObject({ title: 'Hello #Toronto', contentType: 'message', messageCard: true, createdAtMillis: 30 })
    expect(snapshot.postCount).toBe(4)
    expect(snapshot.totalRadiusKm).toBe(20)
    expect(snapshot.claims).toHaveLength(4)
  })
  it('uses the same classification for visited accounts and preserves openable post IDs/media', () => {
    const posts = profilePostsFromRealtime(authoredPostsSnapshot('author', documents).posts, 'visitor', '@mark', 'author')
    expect(profilePostsForMode(posts, 'messages')[1]).toMatchObject({ id: 'video-message', mediaType: 'video', video: 'https://example.com/video.mp4', reachKm: 5, origin: [-79, 43] })
  })
  it('moves a repaired legacy message to Messages on the next server snapshot, with unchanged claims/totals', () => {
    const legacy = { id: 'legacy', row: { ...base, caption: 'Hiii' } }
    const before = authoredPostsSnapshot('author', [legacy])
    const after = authoredPostsSnapshot('author', [{ ...legacy, row: { ...legacy.row, contentType: 'message', messageCard: true } }])
    expect(profilePostsForMode(profilePostsFromRealtime(before.posts, 'author', null), 'media')).toHaveLength(1)
    expect(profilePostsForMode(profilePostsFromRealtime(after.posts, 'author', null), 'media')).toHaveLength(0)
    expect(profilePostsForMode(profilePostsFromRealtime(after.posts, 'author', null), 'messages')).toHaveLength(1)
    expect(after.claims).toEqual(before.claims)
    expect(after.totalRadiusKm).toBe(before.totalRadiusKm)
  })
})
