import { describe, expect, it } from 'vitest'
import {
  emptyFoodCubeSession,
  expireFoodCubeSession,
  reconcileFoodCubeSession,
} from '../foodCubeSession'

const MAX_MS = 30_000

describe('food cube session', () => {
  it('appears only while food context is open', () => {
    const closed = reconcileFoodCubeSession(emptyFoodCubeSession(), false, 1_000, MAX_MS)
    expect(closed).toMatchObject({ active: false, session: emptyFoodCubeSession() })

    const opened = reconcileFoodCubeSession(closed.session, true, 1_000, MAX_MS)
    expect(opened).toMatchObject({ active: true, remainingMs: MAX_MS })
    expect(opened.session.deadline).toBe(31_000)

    const cleared = reconcileFoodCubeSession(opened.session, false, 2_000, MAX_MS)
    expect(cleared).toMatchObject({ active: false, session: emptyFoodCubeSession() })
  })

  it('expires after 30 seconds and stays off until food context clears', () => {
    const opened = reconcileFoodCubeSession(emptyFoodCubeSession(), true, 0, MAX_MS)
    const expired = expireFoodCubeSession(opened.session, opened.session.deadline as number)
    const stillOpen = reconcileFoodCubeSession(expired, true, MAX_MS + 1, MAX_MS)
    expect(stillOpen).toMatchObject({ active: false })
    expect(stillOpen.session.exhausted).toBe(true)

    const closed = reconcileFoodCubeSession(stillOpen.session, false, MAX_MS + 2, MAX_MS)
    const reopened = reconcileFoodCubeSession(closed.session, true, MAX_MS + 3, MAX_MS)
    expect(reopened).toMatchObject({ active: true, remainingMs: MAX_MS })
  })

  it('does not let a stale timeout close a newer food session', () => {
    const first = reconcileFoodCubeSession(emptyFoodCubeSession(), true, 0, MAX_MS)
    const closed = reconcileFoodCubeSession(first.session, false, 1_000, MAX_MS)
    const second = reconcileFoodCubeSession(closed.session, true, 2_000, MAX_MS)
    expect(expireFoodCubeSession(second.session, first.session.deadline as number)).toBe(second.session)
  })
})
