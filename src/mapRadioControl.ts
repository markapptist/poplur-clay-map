export type RadioPlaybackState = 'off' | 'muted' | 'fallback' | 'live'
export type RadioStationSelectionSource = 'listener' | 'boot' | 'map'

/**
 * The Map keeps its radio readout directly below the current place. A nearby
 * stream may take a moment to resolve, so an active fallback still gets an
 * honest label instead of leaving the listener wondering whether the button
 * worked.
 */
export function mapRadioStatusLabel(
  state: RadioPlaybackState,
  stationName: string | null,
): string | null {
  if (state === 'off') return null
  const station = stationName?.trim() || 'Poplur Radio'
  const status = state === 'muted' ? 'MUTED' : state === 'live' ? 'LIVE' : 'ON AIR'
  return `${station} · ${status}`
}

/** Only the full Radio deck owns the richer continuously rendered audio bed. */
export function shouldUseRichRadioBed(source: RadioStationSelectionSource): boolean {
  return source === 'listener'
}

/** Small external store so React surfaces follow real radio edges without polling. */
export function createRadioPlaybackStore(initial: RadioPlaybackState = 'off') {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => state,
    publish: (next: RadioPlaybackState) => {
      if (next === state) return
      state = next
      listeners.forEach(listener => listener())
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export interface NearbyRadioEntry {
  url: string
}

/**
 * One abortable nearby-station request for the Map control. A stop or newer
 * start invalidates the old request before it can resurrect audio.
 */
export function createNearbyRadioController<T extends NearbyRadioEntry>({
  lookup,
  isActive,
  readSelectionGeneration = () => 0,
  play,
}: {
  lookup: (lat: number, lng: number, signal: AbortSignal) => Promise<T[]>
  isActive: () => boolean
  readSelectionGeneration?: () => number
  play: (station: T) => void
}) {
  let generation = 0
  let request: AbortController | null = null

  const stop = () => {
    generation += 1
    request?.abort()
    request = null
  }

  const start = async (lat: number, lng: number): Promise<T | null> => {
    stop()
    const ownGeneration = generation
    const selectionAtStart = readSelectionGeneration()
    const controller = new AbortController()
    request = controller
    try {
      const stations = await lookup(lat, lng, controller.signal)
      if (controller.signal.aborted || generation !== ownGeneration || !isActive()
        || readSelectionGeneration() !== selectionAtStart) return null
      const station = stations.find(candidate => /^https:\/\//i.test(candidate.url)) ?? null
      if (!station) return null
      play(station)
      return station
    } catch {
      return null
    } finally {
      if (request === controller) request = null
    }
  }

  return { start, stop }
}
