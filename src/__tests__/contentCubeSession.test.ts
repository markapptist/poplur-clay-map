import { describe, expect, it } from 'vitest'
import {
  emptyContentCubeSession,
  expireContentCubeSession,
  reconcileContentCubeSession,
} from '../contentCubeSession'

const MAX_MS = 30_000

describe('food cube session', () => {
  it('appears only while food context is open', () => {
    const closed = reconcileContentCubeSession(emptyContentCubeSession(), false, 1_000, MAX_MS)
    expect(closed).toMatchObject({ active: false, session: emptyContentCubeSession() })

    const opened = reconcileContentCubeSession(closed.session, true, 1_000, MAX_MS)
    expect(opened).toMatchObject({ active: true, remainingMs: MAX_MS })
    expect(opened.session.deadline).toBe(31_000)

    const cleared = reconcileContentCubeSession(opened.session, false, 2_000, MAX_MS)
    expect(cleared).toMatchObject({ active: false, session: emptyContentCubeSession() })
  })

  it('expires after 30 seconds and stays off until food context clears', () => {
    const opened = reconcileContentCubeSession(emptyContentCubeSession(), true, 0, MAX_MS)
    const expired = expireContentCubeSession(opened.session, opened.session.deadline as number)
    const stillOpen = reconcileContentCubeSession(expired, true, MAX_MS + 1, MAX_MS)
    expect(stillOpen).toMatchObject({ active: false })
    expect(stillOpen.session.exhausted).toBe(true)

    const closed = reconcileContentCubeSession(stillOpen.session, false, MAX_MS + 2, MAX_MS)
    const reopened = reconcileContentCubeSession(closed.session, true, MAX_MS + 3, MAX_MS)
    expect(reopened).toMatchObject({ active: true, remainingMs: MAX_MS })
  })

  it('does not let a stale timeout close a newer food session', () => {
    const first = reconcileContentCubeSession(emptyContentCubeSession(), true, 0, MAX_MS)
    const closed = reconcileContentCubeSession(first.session, false, 1_000, MAX_MS)
    const second = reconcileContentCubeSession(closed.session, true, 2_000, MAX_MS)
    expect(expireContentCubeSession(second.session, first.session.deadline as number)).toBe(second.session)
  })
})
