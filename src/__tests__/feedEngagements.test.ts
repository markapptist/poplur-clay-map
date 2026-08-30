import { beforeEach, describe, expect, it, vi } from 'vitest'

const getIdToken = vi.fn(async () => 'firebase-id-token')

vi.mock('../nativeBridge', () => ({ isNativeShell: () => false }))
vi.mock('../nativeAuth', () => ({ authToken: () => null, requestAuthToken: vi.fn() }))
vi.mock('../webFirebase', () => ({
  webAuth: () => ({ currentUser: { getIdToken } }),
}))

import {
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

describe('server-authoritative Feed engagements', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    getIdToken.mockResolvedValue('firebase-id-token')
    resetFeedEngagementsForTests()
  })

  it('builds a bounded payload with no body, coordinates, counters or radius', () => {
    expect(postEngagementPayload(
      'firestore:post-1',
      'comment',
      'evt_1234567890123456',
    )).toEqual({
      postId: 'post-1',
      eventId: 'evt_1234567890123456',
      kind: 'comment',
    })
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
    )).resolves.toMatchObject({ postId: 'post-1', kind: 'like' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const first = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    const second = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(first).toEqual(second)
    expect(first).toEqual({ data: {
      postId: 'post-1',
      eventId: 'evt_1234567890123456',
      kind: 'like',
    } })
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      authorization: 'Bearer firebase-id-token',
    })
  })

  it('coalesces decoder recovery views until the real replay boundary', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ result: { ...result, kind: 'view' } }),
    } as Response)

    await recordVisiblePostView('post-1', 10_000)
    await recordVisiblePostView('post-1', 20_000)
    await recordVisiblePostView('post-1', 40_000)

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
