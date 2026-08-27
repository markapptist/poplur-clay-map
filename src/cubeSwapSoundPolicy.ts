export interface CubeSwapSoundInput {
  wheelFocused: boolean
  activeTab: string
  previousEventSignal: string
  nextEventSignal: string
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

/** A bounded event cube returning to the current Map navigator is itself a
 * real pop, not silent cleanup. This explicit branch protects airplane,
 * country, news, weather and boat returns even if the tab wheel happens to be
 * open while their timers clear. All ordinary non-wheel swaps keep the same
 * normal pop behavior they already had. */
export function cubeSwapShouldPlaySound({
  wheelFocused,
  activeTab,
  previousEventSignal,
  nextEventSignal,
}: CubeSwapSoundInput): boolean {
  const mapReturn = isMapCubeReturnTransition(activeTab, previousEventSignal, nextEventSignal)
  return !wheelFocused || mapReturn
}
