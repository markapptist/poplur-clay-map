import { describe, expect, it } from 'vitest'
import {
  emptyDiscoCubeSession,
  expireDiscoCubeSession,
  reconcileDiscoCubeSession,
} from '../discoCubeSession'

const MAX_MS = 30_000

describe('disco cube playback session', () => {
  it('waits ten seconds, then keeps the original deadline through playback heartbeats', () => {
    const first = reconcileDiscoCubeSession(emptyDiscoCubeSession(), true, 1_000, MAX_MS)
    expect(first).toMatchObject({ active: false, activationDelayMs: 10_000, remainingMs: 30_000 })
    expect(first.session.eligibleAt).toBe(11_000)

    const heartbeat = reconcileDiscoCubeSession(first.session, true, 6_000, MAX_MS)
    expect(heartbeat).toMatchObject({ active: false, activationDelayMs: 5_000 })

    const ready = reconcileDiscoCubeSession(first.session, true, 11_000, MAX_MS)
    expect(ready).toMatchObject({ active: true, activationDelayMs: null, remainingMs: 30_000 })
    expect(ready.session.deadline).toBe(41_000)
  })

  it('does not activate for a short sound that stops before ten seconds', () => {
    const started = reconcileDiscoCubeSession(emptyDiscoCubeSession(), true, 0, MAX_MS)
    const stopped = reconcileDiscoCubeSession(started.session, false, 9_999, MAX_MS)
    expect(stopped.active).toBe(false)
    expect(stopped.session).toEqual(emptyDiscoCubeSession())
  })

  it('ends immediately when all music stops', () => {
    const started = reconcileDiscoCubeSession(emptyDiscoCubeSession(), true, 0, MAX_MS)
    const stopped = reconcileDiscoCubeSession(started.session, false, 4_000, MAX_MS)
    expect(stopped.active).toBe(false)
    expect(stopped.session).toEqual(emptyDiscoCubeSession())
  })

  it('starts its 30 seconds only when the disco cube can be seen', () => {
    const hiddenStart = reconcileDiscoCubeSession(
      emptyDiscoCubeSession(),
      true,
      1_000,
      MAX_MS,
      false,
    )
    expect(hiddenStart).toMatchObject({ active: false, activationDelayMs: 10_000, remainingMs: MAX_MS })
    expect(hiddenStart.session.deadline).toBeNull()

    const shown = reconcileDiscoCubeSession(hiddenStart.session, true, 6_000, MAX_MS, true)
    expect(shown).toMatchObject({ active: false, activationDelayMs: 5_000, remainingMs: MAX_MS })

    const ready = reconcileDiscoCubeSession(hiddenStart.session, true, 11_000, MAX_MS, true)
    expect(ready).toMatchObject({ active: true, remainingMs: MAX_MS })
    expect(ready.session.deadline).toBe(41_000)
  })

  it('pauses the visible-time budget while a higher-priority cube is in front', () => {
    const started = reconcileDiscoCubeSession(emptyDiscoCubeSession(), true, 0, MAX_MS)
    const ready = reconcileDiscoCubeSession(started.session, true, 10_000, MAX_MS)
    const hidden = reconcileDiscoCubeSession(ready.session, true, 20_000, MAX_MS, false)
    expect(hidden).toMatchObject({ active: false, remainingMs: 20_000 })
    expect(hidden.session.deadline).toBeNull()

    const resumed = reconcileDiscoCubeSession(hidden.session, true, 25_000, MAX_MS, true)
    expect(resumed).toMatchObject({ active: true, remainingMs: 20_000 })
    expect(resumed.session.deadline).toBe(45_000)
  })

  it('expires at 30 seconds and cannot re-arm until playback first stops', () => {
    const started = reconcileDiscoCubeSession(emptyDiscoCubeSession(), true, 10, MAX_MS)
    const ready = reconcileDiscoCubeSession(started.session, true, 10_010, MAX_MS)
    const deadline = ready.session.deadline as number
    const expiredSession = expireDiscoCubeSession(ready.session, deadline)
    const stillPlaying = reconcileDiscoCubeSession(expiredSession, true, deadline + 1, MAX_MS)
    expect(stillPlaying.active).toBe(false)
    expect(stillPlaying.session.exhausted).toBe(true)

    const stopped = reconcileDiscoCubeSession(stillPlaying.session, false, deadline + 2, MAX_MS)
    const restarted = reconcileDiscoCubeSession(stopped.session, true, deadline + 3, MAX_MS)
    expect(restarted.active).toBe(false)
    const restartedReady = reconcileDiscoCubeSession(restarted.session, true, deadline + 3 + 10_000, MAX_MS)
    expect(restartedReady.active).toBe(true)
    expect(restartedReady.remainingMs).toBe(MAX_MS)
  })

  it('ignores a stale timeout from an earlier session', () => {
    const first = reconcileDiscoCubeSession(emptyDiscoCubeSession(), true, 0, MAX_MS)
    const firstReady = reconcileDiscoCubeSession(first.session, true, 10_000, MAX_MS)
    const stopped = reconcileDiscoCubeSession(firstReady.session, false, 11_000, MAX_MS)
    const second = reconcileDiscoCubeSession(stopped.session, true, 12_000, MAX_MS)
    const secondReady = reconcileDiscoCubeSession(second.session, true, 22_000, MAX_MS)
    const stale = expireDiscoCubeSession(secondReady.session, firstReady.session.deadline as number)
    expect(stale).toBe(secondReady.session)
    expect(stale.exhausted).toBe(false)
  })
})
