export interface MapBuildingCullScheduler {
  markCameraGesture(): void
  markSourceTilesChanged(): void
  markPolicyChanged(): void
  onIdle(threeDimensional: boolean): void
}

export interface MapLayerVisibilityAdapter {
  getLayer(id: string): unknown
  getLayoutProperty(id: string, name: 'visibility'): unknown
  setLayoutProperty(id: string, name: 'visibility', value: 'visible' | 'none'): void
}

export interface SettledMapLayerVisibilityRetry {
  request(enabled: boolean): boolean
  retryOnSettled(): boolean
  hasPending(): boolean
}

/**
 * Applies a visibility state without caching a failed style-transition write.
 * Mapbox can expose a just-added layer while rejecting its first layout
 * mutation; callers must retry that edge rather than remember a state the
 * renderer never accepted.
 */
export function reconcileMapLayerVisibility(
  map: MapLayerVisibilityAdapter,
  layerIds: readonly string[],
  enabled: boolean,
): boolean {
  const desired = enabled ? 'visible' : 'none'
  let found = false
  let settled = true
  for (const id of layerIds) {
    try {
      if (!map.getLayer(id)) continue
      found = true
      const current = map.getLayoutProperty(id, 'visibility') === 'none' ? 'none' : 'visible'
      if (current !== desired) map.setLayoutProperty(id, 'visibility', desired)
      const applied = map.getLayoutProperty(id, 'visibility') === 'none' ? 'none' : 'visible'
      if (applied !== desired) settled = false
    } catch {
      settled = false
    }
  }
  return found && settled
}

/**
 * Records a style-transition visibility rejection and retries it only on the
 * next real settled edge. There is no timer or render loop: repeated idle
 * notifications after success are no-ops.
 */
export function createSettledMapLayerVisibilityRetry(
  apply: (enabled: boolean) => boolean,
): SettledMapLayerVisibilityRetry {
  let pending: boolean | null = null
  const attempt = (enabled: boolean) => {
    const settled = apply(enabled)
    pending = settled ? null : enabled
    return settled
  }
  return {
    request: attempt,
    retryOnSettled() {
      if (pending == null) return true
      return attempt(pending)
    },
    hasPending() {
      return pending != null
    },
  }
}

/**
 * Coalesces camera, tile and thermal changes into one settled building-cull
 * pass. The pass clears its pending bits before running so the filter's own
 * render/idle edge cannot create an update loop.
 */
export function createMapBuildingCullScheduler(
  runSettledCull: (refreshSelection: boolean) => boolean | void,
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
      // An intentionally empty filter is installed at style load so the map
      // can never flash a whole city of extrusions. On a cold PMTiles launch,
      // however, the first idle edge can arrive before the building source is
      // queryable. Do not treat that deferred attempt as the settled result:
      // keep one pending epoch armed so the next source/idle edge can populate
      // the finite building batch without requiring a second user gesture.
      const settled = runSettledCull(refreshSelection)
      if (settled === false) {
        cameraGesturePending = true
        sourceTilesChanged = true
        sourceChangesArmed = true
      }
    },
  }
}
