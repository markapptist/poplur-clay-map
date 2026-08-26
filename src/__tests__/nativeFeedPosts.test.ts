import { describe, expect, it } from 'vitest'
import { normalizeNativeFeedPosts } from '../nativeFeedPosts'

describe('native feed post boundary', () => {
  it('accepts bounded public media rows and sorts newest first', () => {
    const rows = normalizeNativeFeedPosts({ posts: [
      { id: 'old', mediaURL: 'https://cdn.example/old.mp4', username: 'one', createdAtMillis: 1 },
      { id: 'new', mediaURL: 'https://cdn.example/new.mp4', posterURL: 'https://cdn.example/new.jpg', username: '@two', radiusMeters: 2500, createdAtMillis: 2 },
    ] })
    expect(rows.map(row => row.id)).toEqual(['new', 'old'])
    expect(rows[0]).toMatchObject({ username: '@two', radiusMeters: 2500 })
    expect(rows[1].username).toBe('@one')
  })

  it('preserves uploaded photos alongside uploaded videos', () => {
    const rows = normalizeNativeFeedPosts({ posts: [
      {
        id: 'my-photo',
        mediaURL: 'https://cdn.example/my-upload.jpg',
        username: 'me',
        channelId: 'food',
        createdAtMillis: 2,
      },
      {
        id: 'my-video',
        mediaURL: 'https://cdn.example/my-upload.mp4',
        mediaType: 'video',
        username: 'me',
        channelId: 'food',
        createdAtMillis: 1,
      },
    ] })

    expect(rows.map(row => [row.id, row.mediaType])).toEqual([
      ['my-photo', 'photo'],
      ['my-video', 'video'],
    ])
  })

  it('drops malformed or unsafe media URLs at the native boundary', () => {
    expect(normalizeNativeFeedPosts({ posts: [
      { id: 'script', mediaURL: 'javascript:alert(1)' },
      { id: 'missing' },
      null,
    ] })).toEqual([])
  })

  it('preserves bounded engagement and a declared approximate origin', () => {
    const [row] = normalizeNativeFeedPosts({ posts: [{
      id: 'public-origin',
      mediaURL: 'https://cdn.example/public.mp4',
      viewCount: 44,
      likeCount: 12,
      commentCount: 3,
      shareCount: 2,
      locationVisibility: 'approximate',
      originLatitude: 43.65,
      originLongitude: -79.38,
    }] })
    expect(row).toMatchObject({
      viewCount: 44,
      likeCount: 12,
      commentCount: 3,
      shareCount: 2,
      locationVisibility: 'approximate',
      originLatitude: 43.65,
      originLongitude: -79.38,
    })
  })

  it('never admits coordinates for hidden or invalid origins', () => {
    const rows = normalizeNativeFeedPosts({ posts: [
      {
        id: 'hidden',
        mediaURL: 'https://cdn.example/hidden.mp4',
        locationVisibility: 'hidden',
        originLatitude: 43.65,
        originLongitude: -79.38,
      },
      {
        id: 'invalid',
        mediaURL: 'https://cdn.example/invalid.mp4',
        locationVisibility: 'approximate',
        originLatitude: 143.65,
        originLongitude: -79.38,
      },
    ] })
    expect(rows[0]).toMatchObject({ locationVisibility: 'hidden' })
    expect(rows[0].originLatitude).toBeUndefined()
    expect(rows[0].originLongitude).toBeUndefined()
    expect(rows[1]).toMatchObject({ locationVisibility: 'approximate' })
    expect(rows[1].originLatitude).toBeUndefined()
    expect(rows[1].originLongitude).toBeUndefined()
  })
})
