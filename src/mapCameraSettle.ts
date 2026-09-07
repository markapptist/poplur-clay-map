interface MapCameraState {
  isMoving(): boolean
  isStyleLoaded(): boolean
  __cinematic?: boolean
}

/** Automatic pitch correction must never replace an active user camera move. */
export function mapCameraCanSettle(map: MapCameraState): boolean {
  return !map.isMoving() && !map.__cinematic && map.isStyleLoaded()
}

export function createMapCameraSettle(
  map: MapCameraState,
  requestFrame: (callback: () => void) => number,
  cancelFrame: (id: number) => void,
  apply: (pitch: number, bearing: number) => void,
) {
  let frame: number | null = null
  let generation = 0
  const cancel = () => {
    generation += 1
    if (frame !== null) cancelFrame(frame)
    frame = null
  }
  return {
    get pending() { return frame !== null },
    cancel,
    request(pitch: number, bearing: number) {
      cancel()
      if (!mapCameraCanSettle(map)) return
      const requestedGeneration = generation
      frame = requestFrame(() => {
        if (requestedGeneration !== generation) return
        frame = null
        // stop()/easeTo() emits end events synchronously. A settle queued by
        // the old move can run after a new zoom has already started.
        // Drop it; the new move's own end event requests its final correction.
        if (mapCameraCanSettle(map)) apply(pitch, bearing)
      })
    },
  }
}
