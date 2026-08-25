import { describe, expect, it } from 'vitest'
import {
  emptyDiscoCubeSession,
  expireDiscoCubeSession,
  reconcileDiscoCubeSession,
} from '../discoCubeSession'

const MAX_MS = 30_000

describe('disco cube playback session', () => {
  it('starts once and keeps the original deadline through playback heartbeats', () => {
    const first = reconcileDiscoCubeSession(emptyDiscoCubeSession(), true, 1_000, MAX_MS)
    expect(first).toMatchObject({ active: true, remainingMs: 30_000 })
    expect(first.session.deadline).toBe(31_000)

    const heartbeat = reconcileDiscoCubeSession(first.session, true, 6_000, MAX_MS)
    expect(heartbeat).toMatchObject({ active: true, remainingMs: 25_000 })
    expect(heartbeat.session.deadline).toBe(31_000)
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
    expect(hiddenStart).toMatchObject({ active: false, remainingMs: MAX_MS })
    expect(hiddenStart.session.deadline).toBeNull()

    const shown = reconcileDiscoCubeSession(hiddenStart.session, true, 6_000, MAX_MS, true)
    expect(shown).toMatchObject({ active: true, remainingMs: MAX_MS })
    expect(shown.session.deadline).toBe(36_000)
  })

  it('pauses the visible-time budget while a higher-priority cube is in front', () => {
    const started = reconcileDiscoCubeSession(emptyDiscoCubeSession(), true, 0, MAX_MS)
    const hidden = reconcileDiscoCubeSession(started.session, true, 10_000, MAX_MS, false)
    expect(hidden).toMatchObject({ active: false, remainingMs: 20_000 })
    expect(hidden.session.deadline).toBeNull()

    const resumed = reconcileDiscoCubeSession(hidden.session, true, 25_000, MAX_MS, true)
    expect(resumed).toMatchObject({ active: true, remainingMs: 20_000 })
    expect(resumed.session.deadline).toBe(45_000)
  })

  it('expires at 30 seconds and cannot re-arm until playback first stops', () => {
    const started = reconcileDiscoCubeSession(emptyDiscoCubeSession(), true, 10, MAX_MS)
    const deadline = started.session.deadline as number
    const expiredSession = expireDiscoCubeSession(started.session, deadline)
    const stillPlaying = reconcileDiscoCubeSession(expiredSession, true, deadline + 1, MAX_MS)
    expect(stillPlaying.active).toBe(false)
    expect(stillPlaying.session.exhausted).toBe(true)

    const stopped = reconcileDiscoCubeSession(stillPlaying.session, false, deadline + 2, MAX_MS)
    const restarted = reconcileDiscoCubeSession(stopped.session, true, deadline + 3, MAX_MS)
    expect(restarted.active).toBe(true)
    expect(restarted.remainingMs).toBe(MAX_MS)
  })

  it('ignores a stale timeout from an earlier session', () => {
    const first = reconcileDiscoCubeSession(emptyDiscoCubeSession(), true, 0, MAX_MS)
    const stopped = reconcileDiscoCubeSession(first.session, false, 1_000, MAX_MS)
    const second = reconcileDiscoCubeSession(stopped.session, true, 2_000, MAX_MS)
    const stale = expireDiscoCubeSession(second.session, first.session.deadline as number)
    expect(stale).toBe(second.session)
    expect(stale.exhausted).toBe(false)
  })
})
