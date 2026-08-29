/**
 * The workbench simulation is deliberately local to a device: it controls
 * bundled/demo activity only and can never hide or mutate real Firebase data.
 *
 * It defaults to paused for a clean test reset. A tester can still turn it on
 * explicitly when they need to inspect a populated demo surface.
 */

const STORAGE_KEY = 'poplur.workbench.liveSimulation'
export const SIMULATION_CHANGE_EVENT = 'poplur-workbench-simulation-change'
let memoryEnabled = false

export const WORKBENCH_ADMIN_UIDS = new Set([
  'LiEG6SNtKEZN6eEGeybf0afZnHm1', // testcall@poplur.com
  'eoP2Z0ElxIa0Eua7xpFxNlr6tur1', // mark@apptist.ca
])

function storage(): Storage | null {
  if (typeof window === 'undefined') return null
  try { return window.localStorage } catch { return null }
}

/** Safe default: only an intentional switch enables locally-generated activity. */
export function isLiveSimulationEnabled(): boolean {
  const persisted = storage()?.getItem(STORAGE_KEY)
  return persisted == null ? memoryEnabled : persisted === 'on'
}

export function setLiveSimulationEnabled(enabled: boolean): boolean {
  const next = enabled === true
  memoryEnabled = next
  try {
    if (next) storage()?.setItem(STORAGE_KEY, 'on')
    else storage()?.removeItem(STORAGE_KEY)
  } catch { /* memory-less/private tabs retain the safe off default */ }
  try { window.dispatchEvent(new CustomEvent(SIMULATION_CHANGE_EVENT, { detail: next })) } catch { /* SSR */ }
  return next
}

export function onLiveSimulationChange(listener: (enabled: boolean) => void): () => void {
  const apply = () => listener(isLiveSimulationEnabled())
  window.addEventListener(SIMULATION_CHANGE_EVENT, apply)
  window.addEventListener('storage', apply)
  return () => {
    window.removeEventListener(SIMULATION_CHANGE_EVENT, apply)
    window.removeEventListener('storage', apply)
  }
}

export function canManageLiveSimulation(uid: string | null | undefined): boolean {
  return typeof uid === 'string' && WORKBENCH_ADMIN_UIDS.has(uid)
}
