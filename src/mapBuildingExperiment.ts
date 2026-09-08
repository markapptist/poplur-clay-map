/** Full-density map trial paused at the user's request after heat returned.
 * Keep false for the sparse-building / culling-on comparison.
 * Baseline details: .codex/releases/map-density-experiment-20260907/baseline.json.
 */
export const MAP_BUILDING_EXPERIMENT_ENABLED = false
export const MAP_BUILDING_EXPERIMENT = {
  density: 1,
  culling: false,
  revealZoom: 13.2,
  pitch: 55,
  maxPitch: 60,
} as const
