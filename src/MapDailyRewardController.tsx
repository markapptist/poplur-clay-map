import { useEffect, useRef, useState } from 'react'
import PoplurStatusToast from './PoplurStatusToast'
import { grantDailyMapReward } from './poplurCredits'
import {
  RADIUS_REWARD_STORAGE_KEY,
  parseRadiusRewardClaim,
  radiusRewardDayKey,
  selectRadiusRewardOutcome,
  serializeRadiusRewardClaim,
  type RadiusRewardOutcome,
} from './radiusRewardRoll'
import {
  RADIUS_REWARD_DICE_READY_EVENT,
  RADIUS_REWARD_NAVIGATOR_EVENT,
  announceRadiusRewardDiceRoll,
  announceRadiusRewardNavigator,
  radiusRewardDiceReadySignalFromEvent,
  radiusRewardNavigatorSignalFromEvent,
} from './radiusRewardNavigator'
import {
  RADIUS_REWARD_DICE_REDUCED_TUMBLE_MS,
  RADIUS_REWARD_DICE_TUMBLE_MS,
} from './radiusRewardDiceMotion'

interface RewardToast {
  title: string
  detail: string
}

function secureRewardRandomUnit(): number {
  const sample = new Uint32Array(1)
  if (typeof globalThis.crypto?.getRandomValues !== 'function') return Math.random()
  globalThis.crypto.getRandomValues(sample)
  return sample[0] / 0x1_0000_0000
}

export function readDailyMapReward(nowMs = Date.now()): RadiusRewardOutcome | null {
  try {
    const raw = window.localStorage.getItem(RADIUS_REWARD_STORAGE_KEY)
    return parseRadiusRewardClaim(raw, nowMs)
  } catch {
    return null
  }
}

/** Owns the production free-roll handshake. The navigator/model renderer stays
 * in HomeTwin; this controller contributes no renderer or idle loop. It only
 * reacts to a user-started session, runs one finite tumble, writes one stable
 * daily Credit entry, shows a bounded toast, then returns the normal Map cube.
 */
export default function MapDailyRewardController({ enabled }: { enabled: boolean }) {
  const [toast, setToast] = useState<RewardToast | null>(null)
  const sessionRef = useRef<number | null>(null)
  const startedSessionRef = useRef<number | null>(null)
  const settleTimerRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) return
    const clearTimers = () => {
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current)
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
      settleTimerRef.current = null
      closeTimerRef.current = null
    }
    const onNavigator = (event: Event) => {
      const signal = radiusRewardNavigatorSignalFromEvent(event)
      if (!signal) return
      clearTimers()
      sessionRef.current = signal.active ? signal.changedAt : null
      startedSessionRef.current = null
      if (!signal.active) setToast(null)
    }
    const onReady = (event: Event) => {
      const signal = radiusRewardDiceReadySignalFromEvent(event)
      if (!signal || signal.session !== sessionRef.current) return
      if (startedSessionRef.current === signal.session) return
      startedSessionRef.current = signal.session

      const existing = readDailyMapReward()
      const outcome = existing ?? selectRadiusRewardOutcome(secureRewardRandomUnit())
      if (!announceRadiusRewardDiceRoll(signal.session, outcome.face)) return

      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const tumbleMs = reducedMotion
        ? RADIUS_REWARD_DICE_REDUCED_TUMBLE_MS
        : RADIUS_REWARD_DICE_TUMBLE_MS
      settleTimerRef.current = window.setTimeout(() => {
        settleTimerRef.current = null
        if (sessionRef.current !== signal.session) return

        const claimedAtMs = Date.now()
        const day = radiusRewardDayKey(claimedAtMs)
        const granted = !existing && grantDailyMapReward(
          outcome.credits,
          day,
          `${outcome.title} — daily Map roll`,
        )
        try {
          window.localStorage.setItem(
            RADIUS_REWARD_STORAGE_KEY,
            serializeRadiusRewardClaim(outcome, claimedAtMs),
          )
        } catch { /* private storage: the ledger still guards this session */ }

        setToast(granted
          ? { title: `+${outcome.credits} Credits`, detail: `${outcome.title}. Free daily Map roll claimed.` }
          : { title: 'Daily roll complete', detail: `Today's ${outcome.title} reward was already claimed.` })

        closeTimerRef.current = window.setTimeout(() => {
          closeTimerRef.current = null
          if (sessionRef.current === signal.session) announceRadiusRewardNavigator(false)
        }, 2_400)
      }, tumbleMs + (reducedMotion ? 40 : 80))
    }

    window.addEventListener(RADIUS_REWARD_NAVIGATOR_EVENT, onNavigator)
    window.addEventListener(RADIUS_REWARD_DICE_READY_EVENT, onReady)
    return () => {
      clearTimers()
      sessionRef.current = null
      startedSessionRef.current = null
      window.removeEventListener(RADIUS_REWARD_NAVIGATOR_EVENT, onNavigator)
      window.removeEventListener(RADIUS_REWARD_DICE_READY_EVENT, onReady)
    }
  }, [enabled])

  return enabled && toast
    ? <PoplurStatusToast title={toast.title} detail={toast.detail} />
    : null
}
