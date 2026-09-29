import { shouldPlayPop } from './popSoundPolicy'

export interface CubeSwapSoundInput {
  wheelFocused: boolean
  activeTab: string
  previousEventSignal: string
  nextEventSignal: string
  /** The navigation gesture has already produced its one immediate pop. */
  navigationSoundClaimed?: boolean
}

/** Once a target begins its exit/swap/enter sequence, keep the sound decision
 * made on the initiating render. React necessarily renders the exit phase
 * again after a navigation claim has been consumed; recomputing there used to
 * turn a claimed-silent target audible again. A genuinely different target
 * still gets a fresh decision. */
export function pendingCubeSwapSound<T>(
  existing: { model: T; withSound: boolean } | null,
  requestedModel: T,
  nextWithSound: boolean,
): boolean {
  // Silence is sticky for one target, while a later explicit claim may still
  // silence a target that was initially going to sound.
  return existing?.model === requestedModel
    ? existing.withSound && nextWithSound
    : nextWithSound
}

/** One navigation may render more than once before its destination model is
 * known. Keep a monotonic version for React while exposing only one consumable
 * sound claim to the eventual cube swap. */
export function createCubeNavigationSoundClaimTracker() {
  let serial = 0
  let activeClaim = 0
  let pendingScreenChange = false

  const claim = (): number => {
    activeClaim = ++serial
    return activeClaim
  }

  return {
    claim,
    /** An immediate navigation pop has fired and its semantic screen report is
     * still pending. Claim now, then let the matching lifecycle report renew
     * the claim if an intermediate render consumed it. */
    beginScreenNavigation(): number {
      pendingScreenChange = true
      return claim()
    },
    /** Lifecycle reports are not sound owners by themselves. Only the report
     * paired with an explicitly armed navigation may suppress a cube swap. */
    screenChanged(): number | null {
      if (!pendingScreenChange) return null
      pendingScreenChange = false
      return claim()
    },
    cancelScreenNavigation(): void {
      pendingScreenChange = false
      activeClaim = 0
    },
    screenNavigationPending(): boolean {
      return pendingScreenChange
    },
    claimed(): boolean {
      return activeClaim !== 0
    },
    consume(): boolean {
      const claimed = activeClaim !== 0
      activeClaim = 0
      return claimed
    },
  }
}

function isAmbientMapSignal(signal: string): boolean {
  return signal === 'none' || /^map-hover:.*:globe$/.test(signal)
}

export function isMapCubeReturnTransition(
  activeTab: string,
  previousEventSignal: string,
  nextEventSignal: string,
): boolean {
  return activeTab === 'map'
    && previousEventSignal !== nextEventSignal
    && !isAmbientMapSignal(previousEventSignal)
    && isAmbientMapSignal(nextEventSignal)
}

/** Model changes are visual effects. The committing control owns navigation audio. */
export function cubeSwapShouldPlaySound({
  wheelFocused,
  activeTab,
  previousEventSignal,
  nextEventSignal,
  navigationSoundClaimed = false,
}: CubeSwapSoundInput): boolean {
  if (!shouldPlayPop('decoration')) return false
  if (navigationSoundClaimed) return false
  return !wheelFocused
}
