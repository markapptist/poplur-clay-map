export interface DiscoCubeSession {
  playing: boolean
  exhausted: boolean
  deadline: number | null
  /** Remaining visible time while a higher-priority cube is in front. */
  remainingMs: number | null
}

export interface DiscoCubeDecision {
  session: DiscoCubeSession
  active: boolean
  remainingMs: number | null
}

export function emptyDiscoCubeSession(): DiscoCubeSession {
  return { playing: false, exhausted: false, deadline: null, remainingMs: null }
}

/** Pure state transition for one bounded, visible disco appearance per playback run. */
export function reconcileDiscoCubeSession(
  current: DiscoCubeSession,
  playing: boolean,
  now: number,
  maxMs: number,
  visible = true,
): DiscoCubeDecision {
  if (!playing) {
    return { session: emptyDiscoCubeSession(), active: false, remainingMs: null }
  }
  const session = current.playing
    ? current
    : { playing: true, exhausted: false, deadline: null, remainingMs: maxMs }
  if (session.exhausted) {
    return { session, active: false, remainingMs: null }
  }

  // Calls, camera capture and weather may temporarily outrank music. Preserve
  // the unused part of the 30-second appearance instead of burning it while
  // the disco ball is not actually the cube the user can see.
  if (!visible) {
    if (session.deadline == null) {
      return { session, active: false, remainingMs: session.remainingMs }
    }
    const remainingMs = Math.max(0, session.deadline - now)
    if (remainingMs <= 0) {
      return {
        session: { playing: true, exhausted: true, deadline: null, remainingMs: 0 },
        active: false,
        remainingMs: null,
      }
    }
    return {
      session: { ...session, deadline: null, remainingMs },
      active: false,
      remainingMs,
    }
  }

  const remainingMs = session.deadline == null
    ? session.remainingMs ?? maxMs
    : session.deadline - now
  if (remainingMs <= 0) {
    return {
      session: { playing: true, exhausted: true, deadline: null, remainingMs: 0 },
      active: false,
      remainingMs: null,
    }
  }
  const deadline = session.deadline ?? now + remainingMs
  return {
    session: session.deadline == null
      ? { ...session, deadline, remainingMs: null }
      : session,
    active: true,
    remainingMs,
  }
}

export function expireDiscoCubeSession(
  current: DiscoCubeSession,
  deadline: number,
): DiscoCubeSession {
  if (!current.playing || current.deadline !== deadline) return current
  return { playing: true, exhausted: true, deadline: null, remainingMs: 0 }
}
