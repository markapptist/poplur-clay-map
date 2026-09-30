import { useEffect, useRef, useState } from 'react'
import PoplurStatusToast from './PoplurStatusToast'
import { CreditsRefused, claimDailyMapRoll } from './poplurCredits'
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

/** Owns the production free-roll handshake. The navigator/model renderer stays
 * in HomeTwin; this controller contributes no renderer or idle loop. It only
 * reacts to a user-started session, asks the server for today's roll (the
 * server rolls once per UTC day, pays it, and answers with the same face for
 * the rest of the day), runs one finite tumble to that face, shows a bounded
 * toast, then returns the normal Map cube.
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
    const closeSoon = (session: number) => {
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null
        if (sessionRef.current === session) announceRadiusRewardNavigator(false)
      }, 2_400)
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

      claimDailyMapRoll().then(roll => {
        if (sessionRef.current !== signal.session) return
        if (!announceRadiusRewardDiceRoll(signal.session, roll.face)) return

        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        const tumbleMs = reducedMotion
          ? RADIUS_REWARD_DICE_REDUCED_TUMBLE_MS
          : RADIUS_REWARD_DICE_TUMBLE_MS
        settleTimerRef.current = window.setTimeout(() => {
          settleTimerRef.current = null
          if (sessionRef.current !== signal.session) return
          setToast(roll.alreadyClaimed
            ? { title: 'Daily roll complete', detail: `Today's ${roll.title} reward was already claimed.` }
            : { title: `+${roll.credits} Credits`, detail: `${roll.title}. Free daily Map roll claimed.` })
          closeSoon(signal.session)
        }, tumbleMs + (reducedMotion ? 40 : 80))
      }, error => {
        if (sessionRef.current !== signal.session) return
        // Nothing was paid; the die stays unrolled and today's roll is still there.
        setToast({
          title: 'Daily roll unavailable',
          detail: error instanceof CreditsRefused
            ? error.message
            : 'Poplur could not be reached. Your roll is still waiting; try again in a moment.',
        })
        closeSoon(signal.session)
      })
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
