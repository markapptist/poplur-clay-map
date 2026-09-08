/** User-requested full-density map trial, 7 September 2026.
 * Roll back by setting this switch to false; the original policy is retained.
 * Baseline details: .codex/releases/map-density-experiment-20260907/baseline.json.
 */
export const MAP_BUILDING_EXPERIMENT_ENABLED = true
export const MAP_BUILDING_EXPERIMENT = {
  density: 1,
  culling: false,
  revealZoom: 13.2,
  pitch: 55,
  maxPitch: 60,
} as const
