export type HouseActivityId = 'sleep' | 'snack' | 'relax' | 'dance'

export type HouseLifeState = {
  energy: number
  hunger: number
  fun: number
  x: number
  z: number
  activity: HouseActivityId | 'idle'
  updatedAt: number
}

export type HouseActivity = {
  id: HouseActivityId
  label: string
  glyph: string
  target: { x: number, z: number }
  status: string
}

const STORAGE_KEY = 'poplur.profile.house.v1'
const HOUR_MS = 60 * 60 * 1000

export const HOUSE_ACTIVITIES: readonly HouseActivity[] = [
  { id: 'sleep', label: 'Sleep', glyph: '☾', target: { x: -2.35, z: -1.65 }, status: 'Resting in bed' },
  { id: 'snack', label: 'Snack', glyph: '✦', target: { x: -2.15, z: 1.7 }, status: 'Making a snack' },
  { id: 'relax', label: 'Relax', glyph: '⌁', target: { x: 2.15, z: -1.55 }, status: 'Relaxing on the sofa' },
  { id: 'dance', label: 'Dance', glyph: '♪', target: { x: 1.15, z: 1.2 }, status: 'Dancing at home' },
] as const

function clampNeed(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function defaultHouseLife(now = Date.now()): HouseLifeState {
  return { energy: 82, hunger: 76, fun: 72, x: 0, z: .65, activity: 'idle', updatedAt: now }
}

/** Needs progress only when the House is opened or an action is performed;
    there is no background timer and therefore no idle battery work. */
export function advanceHouseLife(state: HouseLifeState, now = Date.now()): HouseLifeState {
  const elapsedHours = Math.max(0, Math.min(72, (now - state.updatedAt) / HOUR_MS))
  return {
    ...state,
    energy: clampNeed(state.energy - elapsedHours * 1.35),
    hunger: clampNeed(state.hunger - elapsedHours * 1.8),
    fun: clampNeed(state.fun - elapsedHours * .9),
    activity: 'idle',
    updatedAt: now,
  }
}

export function performHouseActivity(state: HouseLifeState, id: HouseActivityId, now = Date.now()): HouseLifeState {
  const current = advanceHouseLife(state, now)
  const activity = HOUSE_ACTIVITIES.find(item => item.id === id)!
  const delta = id === 'sleep'
    ? { energy: 34, hunger: -7, fun: 4 }
    : id === 'snack'
      ? { energy: 3, hunger: 35, fun: 3 }
      : id === 'relax'
        ? { energy: 10, hunger: -3, fun: 25 }
        : { energy: -9, hunger: -5, fun: 36 }
  return {
    ...current,
    energy: clampNeed(current.energy + delta.energy),
    hunger: clampNeed(current.hunger + delta.hunger),
    fun: clampNeed(current.fun + delta.fun),
    x: activity.target.x,
    z: activity.target.z,
    activity: id,
    updatedAt: now,
  }
}

export function moveHouseAvatar(state: HouseLifeState, x: number, z: number, now = Date.now()): HouseLifeState {
  return {
    ...advanceHouseLife(state, now),
    x: Math.max(-2.85, Math.min(2.85, x)),
    z: Math.max(-2.35, Math.min(2.35, z)),
    activity: 'idle',
    updatedAt: now,
  }
}

export function houseMood(state: HouseLifeState) {
  const average = (state.energy + state.hunger + state.fun) / 3
  if (average >= 80) return 'Thriving'
  if (average >= 58) return 'Feeling good'
  if (average >= 36) return 'Needs attention'
  return 'Running low'
}

export function readHouseLife(now = Date.now()): HouseLifeState {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<HouseLifeState> | null
    if (!parsed
      || typeof parsed.energy !== 'number' || !Number.isFinite(parsed.energy)
      || typeof parsed.hunger !== 'number' || !Number.isFinite(parsed.hunger)
      || typeof parsed.fun !== 'number' || !Number.isFinite(parsed.fun)) return defaultHouseLife(now)
    const x = typeof parsed.x === 'number' && Number.isFinite(parsed.x) ? parsed.x : 0
    const z = typeof parsed.z === 'number' && Number.isFinite(parsed.z) ? parsed.z : .65
    const updatedAt = typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : now
    return advanceHouseLife({
      energy: clampNeed(parsed.energy), hunger: clampNeed(parsed.hunger), fun: clampNeed(parsed.fun),
      x: Math.max(-2.85, Math.min(2.85, x)),
      z: Math.max(-2.35, Math.min(2.35, z)),
      activity: HOUSE_ACTIVITIES.some(item => item.id === parsed.activity) ? parsed.activity as HouseActivityId : 'idle',
      updatedAt,
    }, now)
  } catch { return defaultHouseLife(now) }
}

export function saveHouseLife(state: HouseLifeState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* private browsing */ }
}
