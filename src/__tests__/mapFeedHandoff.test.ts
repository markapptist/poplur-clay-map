import { describe, expect, it } from 'vitest'
import { normalizeMapFeedHandoff } from '../mapFeedHandoff'

describe('map to Feed handoff', () => {
  it('keeps a bounded exact video descriptor', () => {
    expect(normalizeMapFeedHandoff({
      id: 'pop-101',
      channelId: 'News',
      username: 'citydesk',
      caption: 'Live from the square',
      mediaURL: 'feed/ad-sports.mp4',
      mediaType: 'video',
      posterURL: 'feed/posters/ad-sports.jpg',
      radiusMeters: 4_200,
      createdAtMillis: 1_800_000_000_000,
      locationVisibility: 'approximate',
      originLatitude: 43.65,
      originLongitude: -79.38,
    })).toEqual({
      id: 'pop-101',
      channelId: 'news',
      username: '@citydesk',
      caption: 'Live from the square',
      mediaURL: 'feed/ad-sports.mp4',
      mediaType: 'video',
      posterURL: 'feed/posters/ad-sports.jpg',
      radiusMeters: 4_200,
      createdAtMillis: 1_800_000_000_000,
      locationVisibility: 'approximate',
      originLatitude: 43.65,
      originLongitude: -79.38,
    })
  })

  it('infers a photo and keeps a bounded inline capture', () => {
    const target = normalizeMapFeedHandoff({
      id: 'photo-1',
      channelId: 'fashion',
      mediaURL: 'data:image/jpeg;base64,AAAA',
      createdAtMillis: 10,
    })
    expect(target?.mediaType).toBe('photo')
    expect(target?.mediaURL).toBe('data:image/jpeg;base64,AAAA')
  })

  it('rejects executable URLs and malformed channels', () => {
    expect(normalizeMapFeedHandoff({
      id: 'bad', channelId: 'news', mediaURL: 'javascript:alert(1)',
    })).toBeNull()
    expect(normalizeMapFeedHandoff({
      id: 'bad', channelId: '../news', mediaURL: 'https://example.com/post.mp4',
    })).toBeNull()
  })

  it('does not expose coordinates unless the origin is public', () => {
    const target = normalizeMapFeedHandoff({
      id: 'private',
      channelId: 'live',
      mediaURL: 'https://example.com/post.mp4',
      locationVisibility: 'hidden',
      originLatitude: 43.65,
      originLongitude: -79.38,
    })
    expect(target?.originLatitude).toBeUndefined()
    expect(target?.originLongitude).toBeUndefined()
  })
})
