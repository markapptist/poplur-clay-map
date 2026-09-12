import { beforeEach, describe, expect, it, vi } from 'vitest'

const getIdToken = vi.fn(async () => 'firebase-id-token')

vi.mock('../nativeBridge', () => ({ isNativeShell: () => false }))
vi.mock('../nativeAuth', () => ({ authToken: () => null, requestAuthToken: vi.fn() }))
vi.mock('../webFirebase', () => ({
  webAuth: () => ({ currentUser: { getIdToken } }),
}))

import {
  POST_ENGAGEMENT_SURFACES,
  postEngagementPayload,
  recordPostEngagement,
  recordVisiblePostView,
  resetFeedEngagementsForTests,
} from '../feedEngagements'

const result = {
  postId: 'post-1',
  eventId: 'evt_1234567890123456',
  kind: 'like' as const,
  applied: true,
  duplicate: false,
  radiusDeltaMeters: 1_000,
  counters: {
    radiusMeters: 2_000,
    organicRadiusMeters: 2_000,
    viewCount: 0,
    likeCount: 1,
    downvoteCount: 0,
    commentCount: 0,
  },
}

const acceptedBy = (fetchMock: { mock: { calls: unknown[][] } }, index: number) =>
  JSON.parse(String((fetchMock.mock.calls[index][1] as RequestInit | undefined)?.body))

describe('server-authoritative Feed engagements', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    getIdToken.mockResolvedValue('firebase-id-token')
    resetFeedEngagementsForTests()
  })

  it('builds a bounded payload with no body, coordinates, counters or radius', () => {
    const payload = postEngagementPayload(
      'firestore:post-1',
      'comment',
      'evt_1234567890123456',
    )
    expect(payload).toEqual({
      postId: 'post-1',
      eventId: 'evt_1234567890123456',
      kind: 'comment',
      surface: 'unknown',
    })
    // The wire shape is the server's allow-list; nothing else may be added.
    expect(Object.keys(payload).sort()).toEqual(['eventId', 'kind', 'postId', 'surface'])
  })

  it('labels the payload with the screen the engagement came from', () => {
    expect([...POST_ENGAGEMENT_SURFACES]).toEqual(['feed', 'map', 'profile', 'unknown'])
    for (const surface of POST_ENGAGEMENT_SURFACES) {
      expect(postEngagementPayload('post-1', 'like', 'evt_1234567890123456', undefined, surface))
        .toEqual({ postId: 'post-1', eventId: 'evt_1234567890123456', kind: 'like', surface })
    }
    expect(postEngagementPayload('post-1', 'comment', 'evt_1234567890123456', ' hello ', 'profile'))
      .toEqual({
        postId: 'post-1',
        eventId: 'evt_1234567890123456',
        kind: 'comment',
        surface: 'profile',
        text: 'hello',
      })
  })

  it('rejects a surface outside the contract before any network call', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const invalid = ['home', 'Feed', '', ' map', 'feed ', null, 0, {}, ['feed']]
    for (const surface of invalid) {
      expect(() => postEngagementPayload(
        'post-1',
        'like',
        'evt_1234567890123456',
        undefined,
        surface as never,
      )).toThrow('Unsupported post engagement surface.')
      await expect(recordPostEngagement('post-1', 'like', 'evt_1234567890123456', undefined, surface as never))
        .rejects.toThrow('Unsupported post engagement surface.')
      expect(() => recordVisiblePostView('post-1', 10_000, surface as never))
        .toThrow('Unsupported post engagement surface.')
    }
    expect(fetchMock).not.toHaveBeenCalled()

    // A refused label must not have consumed the 30 s view fence.
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ result: { ...result, kind: 'view' } }),
    } as Response)
    await recordVisiblePostView('post-1', 10_000, 'feed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('authenticates the callable and retries with the same idempotency id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('uncertain network'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result }),
      } as Response)

    await expect(recordPostEngagement(
      'post-1',
      'like',
      'evt_1234567890123456',
      undefined,
      'feed',
    )).resolves.toMatchObject({ postId: 'post-1', kind: 'like' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const first = acceptedBy(fetchMock, 0)
    const second = acceptedBy(fetchMock, 1)
    expect(first).toEqual(second)
    expect(first).toEqual({ data: {
      postId: 'post-1',
      eventId: 'evt_1234567890123456',
      kind: 'like',
      surface: 'feed',
    } })
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      authorization: 'Bearer firebase-id-token',
    })
  })

  it('sends one message per engagement carrying its surface, unknown when unlabelled', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ result }),
    } as Response)

    await recordPostEngagement('post-1', 'like', 'evt_1234567890123456')
    await recordPostEngagement('post-1', 'comment', 'evt_1234567890123457', 'nice', 'profile')
    await recordVisiblePostView('post-2', 10_000, 'map')
    await recordVisiblePostView('post-3', 10_000)

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(acceptedBy(fetchMock, 0)).toEqual({ data: {
      postId: 'post-1', eventId: 'evt_1234567890123456', kind: 'like', surface: 'unknown',
    } })
    expect(acceptedBy(fetchMock, 1)).toEqual({ data: {
      postId: 'post-1', eventId: 'evt_1234567890123457', kind: 'comment', surface: 'profile', text: 'nice',
    } })
    expect(acceptedBy(fetchMock, 2)).toEqual({ data: {
      postId: 'post-2', eventId: expect.stringMatching(/^evt_[a-z0-9]+_/), kind: 'view', surface: 'map',
    } })
    expect(acceptedBy(fetchMock, 3)).toEqual({ data: {
      postId: 'post-3', eventId: expect.stringMatching(/^evt_[a-z0-9]+_/), kind: 'view', surface: 'unknown',
    } })
  })

  it('coalesces decoder recovery views until the real replay boundary', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ result: { ...result, kind: 'view' } }),
    } as Response)

    await recordVisiblePostView('post-1', 10_000, 'feed')
    await recordVisiblePostView('post-1', 20_000, 'feed')
    await recordVisiblePostView('post-1', 40_000, 'feed')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
