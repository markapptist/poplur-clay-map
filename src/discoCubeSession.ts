export interface DiscoCubeSession {
  playing: boolean
  exhausted: boolean
  /** The playback edge after which a continuous music session is eligible. */
  eligibleAt: number | null
  deadline: number | null
  /** Remaining visible time while a higher-priority cube is in front. */
  remainingMs: number | null
}

export interface DiscoCubeDecision {
  session: DiscoCubeSession
  active: boolean
  /** Delay before the ten-second music threshold is reached. */
  activationDelayMs: number | null
  remainingMs: number | null
}

export function emptyDiscoCubeSession(): DiscoCubeSession {
  return { playing: false, exhausted: false, eligibleAt: null, deadline: null, remainingMs: null }
}

/** Pure state transition for one bounded, visible disco appearance per playback run. */
export function reconcileDiscoCubeSession(
  current: DiscoCubeSession,
  playing: boolean,
  now: number,
  maxMs: number,
  visible = true,
  minPlayingMs = 10_000,
): DiscoCubeDecision {
  if (!playing) {
    return { session: emptyDiscoCubeSession(), active: false, activationDelayMs: null, remainingMs: null }
  }
  const session = current.playing
    ? current
    : {
        playing: true,
        exhausted: false,
        eligibleAt: now + minPlayingMs,
        deadline: null,
        remainingMs: maxMs,
      }
  if (session.exhausted) {
    return { session, active: false, activationDelayMs: null, remainingMs: null }
  }

  const eligibleAt = session.eligibleAt ?? now + minPlayingMs
  const eligibleSession = session.eligibleAt == null ? { ...session, eligibleAt } : session
  if (now < eligibleAt) {
    return {
      session: eligibleSession,
      active: false,
      activationDelayMs: eligibleAt - now,
      remainingMs: eligibleSession.remainingMs,
    }
  }

  // Calls, camera capture and weather may temporarily outrank music. Preserve
  // the unused part of the 30-second appearance instead of burning it while
  // the disco ball is not actually the cube the user can see.
  if (!visible) {
    if (session.deadline == null) {
      return { session: eligibleSession, active: false, activationDelayMs: null, remainingMs: eligibleSession.remainingMs }
    }
    const remainingMs = Math.max(0, session.deadline - now)
    if (remainingMs <= 0) {
      return {
        session: { ...eligibleSession, exhausted: true, deadline: null, remainingMs: 0 },
        active: false,
        activationDelayMs: null,
        remainingMs: null,
      }
    }
    return {
      session: { ...eligibleSession, deadline: null, remainingMs },
      active: false,
      activationDelayMs: null,
      remainingMs,
    }
  }

  const remainingMs = session.deadline == null
    ? session.remainingMs ?? maxMs
    : session.deadline - now
  if (remainingMs <= 0) {
    return {
      session: { ...eligibleSession, exhausted: true, deadline: null, remainingMs: 0 },
      active: false,
      activationDelayMs: null,
      remainingMs: null,
    }
  }
  const deadline = session.deadline ?? now + remainingMs
  return {
    session: eligibleSession.deadline == null
      ? { ...eligibleSession, deadline, remainingMs: null }
      : eligibleSession,
    active: true,
    activationDelayMs: null,
    remainingMs,
  }
}

export function expireDiscoCubeSession(
  current: DiscoCubeSession,
  deadline: number,
): DiscoCubeSession {
  if (!current.playing || current.deadline !== deadline) return current
  return { ...current, playing: true, exhausted: true, deadline: null, remainingMs: 0 }
}
