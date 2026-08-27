export interface MapBuildingCullScheduler {
  markCameraGesture(): void
  markSourceTilesChanged(): void
  markPolicyChanged(): void
  onIdle(threeDimensional: boolean): void
}

/**
 * Coalesces camera, tile and thermal changes into one settled building-cull
 * pass. The pass clears its pending bits before running so the filter's own
 * render/idle edge cannot create an update loop.
 */
export function createMapBuildingCullScheduler(
  runSettledCull: (refreshSelection: boolean) => void,
): MapBuildingCullScheduler {
  let cameraGesturePending = true
  let sourceTilesChanged = true
  // Applying the extrusion filter invalidates Mapbox's source cache and emits
  // `sourcedata` itself. Once a settled pass has run, source notifications are
  // therefore not evidence that another viewport query is needed. Hold them
  // until a real camera gesture starts a new selection epoch.
  let sourceChangesArmed = true

  return {
    markCameraGesture() {
      cameraGesturePending = true
      sourceChangesArmed = true
    },
    markSourceTilesChanged() {
      if (!sourceChangesArmed) return
      sourceTilesChanged = true
    },
    markPolicyChanged() {
      cameraGesturePending = true
    },
    onIdle(threeDimensional) {
      if (!threeDimensional || (!cameraGesturePending && !sourceTilesChanged)) return
      const refreshSelection = sourceTilesChanged
      cameraGesturePending = false
      sourceTilesChanged = false
      sourceChangesArmed = false
      runSettledCull(refreshSelection)
    },
  }
}
