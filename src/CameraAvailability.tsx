export type NativeCameraBudget = {
  state: 'running' | 'parked' | 'recording'
  reason: 'entry' | 'explicitResume' | 'windowExpired' | 'recordingStarted'
    | 'recordingFinished' | 'thermal' | 'leftCamera' | 'unavailable'
  canResume: boolean
  windowMs: number
}

export function readNativeCameraBudget(): NativeCameraBudget | null {
  if (typeof window === 'undefined') return null
  return (window as Window & { __poplurCameraBudget?: NativeCameraBudget }).__poplurCameraBudget ?? null
}

/** Retry ordinary interruptions quietly. Native retains control of thermal
 * recovery; a camera gesture can request resume once native allows it. */
export function cameraParkPlan(budget: NativeCameraBudget | null): { autoResume: boolean } {
  return {
    autoResume: budget?.state === 'parked'
      && budget.canResume
      && !['leftCamera', 'entry', 'thermal'].includes(budget.reason),
  }
}
