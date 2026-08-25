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

  it('drops malformed or unsafe media URLs at the native boundary', () => {
    expect(normalizeNativeFeedPosts({ posts: [
      { id: 'script', mediaURL: 'javascript:alert(1)' },
      { id: 'missing' },
      null,
    ] })).toEqual([])
  })
})
