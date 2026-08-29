export const RADIUS_REWARD_NAVIGATOR_EVENT = 'poplur-radius-reward-navigator'
export const RADIUS_REWARD_DICE_READY_EVENT = 'poplur-radius-reward-dice-ready'
export const RADIUS_REWARD_DICE_ROLL_EVENT = 'poplur-radius-reward-dice-roll'
export const RADIUS_REWARD_DICE_MODEL = 'poplur_dice_lite.glb'
export const RADIUS_REWARD_DICE_SPRITE = 'sprites/poplur_dice_lite_y28_p28_s320.png'

export interface RadiusRewardNavigatorSignal {
  active: boolean
  changedAt: number
}

export type RadiusRewardDiceFace = 1 | 2 | 3 | 4 | 5 | 6

export interface RadiusRewardDiceReadySignal {
  session: number
}

export interface RadiusRewardDiceRollSignal {
  session: number
  pulse: number
  face: RadiusRewardDiceFace
}

let lastNavigatorSession = 0
let lastRollPulse = 0

function nextMonotonicTimestamp(previous: number): number {
  return Math.max(Date.now(), previous + 1)
}

function isSession(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isDiceFace(value: unknown): value is RadiusRewardDiceFace {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 6
}

export function radiusRewardPreviewEnabled(search: string): boolean {
  return new URLSearchParams(search).get('radiusPreview') === '1'
}

export function readRadiusRewardNavigatorSignal(value: unknown): RadiusRewardNavigatorSignal | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<RadiusRewardNavigatorSignal>
  if (typeof candidate.active !== 'boolean') return null
  if (typeof candidate.changedAt !== 'number' || !Number.isFinite(candidate.changedAt)) return null
  return { active: candidate.active, changedAt: candidate.changedAt }
}

export function radiusRewardNavigatorSignalFromEvent(event: Event): RadiusRewardNavigatorSignal | null {
  return readRadiusRewardNavigatorSignal((event as CustomEvent<unknown>).detail)
}

export function readRadiusRewardDiceReadySignal(value: unknown): RadiusRewardDiceReadySignal | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<RadiusRewardDiceReadySignal>
  if (!isSession(candidate.session)) return null
  return { session: candidate.session }
}

export function radiusRewardDiceReadySignalFromEvent(event: Event): RadiusRewardDiceReadySignal | null {
  return readRadiusRewardDiceReadySignal((event as CustomEvent<unknown>).detail)
}

export function readRadiusRewardDiceRollSignal(value: unknown): RadiusRewardDiceRollSignal | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<RadiusRewardDiceRollSignal>
  if (!isSession(candidate.session) || !isSession(candidate.pulse) || !isDiceFace(candidate.face)) return null
  return {
    session: candidate.session,
    pulse: candidate.pulse,
    face: candidate.face,
  }
}

export function radiusRewardDiceRollSignalFromEvent(event: Event): RadiusRewardDiceRollSignal | null {
  return readRadiusRewardDiceRollSignal((event as CustomEvent<unknown>).detail)
}

export function announceRadiusRewardNavigator(active: boolean): RadiusRewardNavigatorSignal {
  lastNavigatorSession = nextMonotonicTimestamp(lastNavigatorSession)
  const signal = { active, changedAt: lastNavigatorSession }
  window.dispatchEvent(new CustomEvent(RADIUS_REWARD_NAVIGATOR_EVENT, { detail: signal }))
  return signal
}

export function announceRadiusRewardDiceReady(session: number): RadiusRewardDiceReadySignal | null {
  if (!isSession(session)) return null
  const signal = { session }
  window.dispatchEvent(new CustomEvent(RADIUS_REWARD_DICE_READY_EVENT, { detail: signal }))
  return signal
}

export function announceRadiusRewardDiceRoll(
  session: number,
  face: RadiusRewardDiceFace,
): RadiusRewardDiceRollSignal | null {
  if (!isSession(session) || !isDiceFace(face)) return null
  lastRollPulse = nextMonotonicTimestamp(lastRollPulse)
  const signal = { session, pulse: lastRollPulse, face }
  window.dispatchEvent(new CustomEvent(RADIUS_REWARD_DICE_ROLL_EVENT, { detail: signal }))
  return signal
}
