/** A single food-context run gets one short fork/knife appearance. */
export interface FoodCubeSession {
  contextOpen: boolean
  exhausted: boolean
  deadline: number | null
}

export interface FoodCubeDecision {
  session: FoodCubeSession
  active: boolean
  remainingMs: number | null
}

export function emptyFoodCubeSession(): FoodCubeSession {
  return { contextOpen: false, exhausted: false, deadline: null }
}

/**
 * Keep the food cube tied to visible food context, but cap a continuous
 * mention/ad run so it cannot hold the navigator forever. A false signal is
 * deliberately the only way to re-arm an expired session.
 */
export function reconcileFoodCubeSession(
  current: FoodCubeSession,
  contextOpen: boolean,
  now: number,
  maxMs: number,
): FoodCubeDecision {
  if (!contextOpen) {
    return { session: emptyFoodCubeSession(), active: false, remainingMs: null }
  }
  if (current.contextOpen && current.exhausted) {
    return { session: current, active: false, remainingMs: null }
  }
  const session = current.contextOpen
    ? current
    : { contextOpen: true, exhausted: false, deadline: now + maxMs }
  const deadline = session.deadline ?? now + maxMs
  const remainingMs = deadline - now
  if (remainingMs <= 0) {
    return {
      session: { ...session, exhausted: true, deadline: null },
      active: false,
      remainingMs: null,
    }
  }
  return {
    session: session.deadline == null ? { ...session, deadline } : session,
    active: true,
    remainingMs,
  }
}

export function expireFoodCubeSession(current: FoodCubeSession, deadline: number): FoodCubeSession {
  if (!current.contextOpen || current.deadline !== deadline) return current
  return { ...current, exhausted: true, deadline: null }
}
