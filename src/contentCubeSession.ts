/**
 * One short cube appearance per run of content on a topic.
 *
 * Written for the food cube in f16a896 (27 Aug) and orphaned by it: the
 * reducer has had no production importer since, `showFoodFace` is hardcoded
 * false, and the producer message it was fed by has no listener. The logic was
 * never food-specific — only its names were — so it is the topic-agnostic
 * machine the sports cube needs, rather than a third one written beside it.
 *
 * Topics are the map tour's own curated vocabulary (MapTourTopic), which
 * already contains both 'sports' and 'food'.
 */
export interface ContentCubeSession {
  contextOpen: boolean
  exhausted: boolean
  deadline: number | null
}

export interface ContentCubeDecision {
  session: ContentCubeSession
  active: boolean
  remainingMs: number | null
}

export function emptyContentCubeSession(): ContentCubeSession {
  return { contextOpen: false, exhausted: false, deadline: null }
}

/**
 * Keep the cube tied to visible context on its topic, but cap a continuous run
 * so it cannot hold the navigator forever — the same reason the weather cube
 * is timed: a condition that held the cube for hours read as a stuck cube
 * rather than as weather. A false signal is deliberately the only way to
 * re-arm an expired session, so leaving the topic and returning shows it
 * again while sitting inside it does not.
 */
export function reconcileContentCubeSession(
  current: ContentCubeSession,
  contextOpen: boolean,
  now: number,
  maxMs: number,
): ContentCubeDecision {
  if (!contextOpen) {
    return { session: emptyContentCubeSession(), active: false, remainingMs: null }
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

export function expireContentCubeSession(current: ContentCubeSession, deadline: number): ContentCubeSession {
  if (!current.contextOpen || current.deadline !== deadline) return current
  return { ...current, exhausted: true, deadline: null }
}
