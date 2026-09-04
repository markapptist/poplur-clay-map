// ── The camera's stepper: filters up and down, lens presets left and right ──
//
// The feed's inner arrows, on the camera. Up and down step the AR filter the
// way the feed's step the channel; left and right step the three lens presets
// (0.5×, 1×, 2×) the way the feed's old post pair stepped posts — and held,
// they keep zooming, like a camcorder's rocker. The pure parts live here so
// they can be tested without a camera.

export type StepDirection = 1 | -1

/** How long a press has to last before it is a zoom rocker rather than a
 *  preset step. Long enough that a firm tap never zooms; short enough that
 *  holding feels immediate. */
export const ZOOM_HOLD_DELAY_MS = 320
/** Zoom change per second while the rocker is held. About a preset a second
 *  through the middle of the range. */
export const ZOOM_HOLD_PER_SECOND = 1.1
/** The rocker's tick. Each tick may reach the camera track's applyConstraints
 *  and the native bridge, so this is a cadence the hardware can follow, not
 *  the display's. */
export const ZOOM_HOLD_TICK_MS = 50

/** The preset one step from the current zoom, wrapping at both ends: 2× steps
 *  in to 0.5×, 0.5× steps out to 2×. "Nearest" first, so a pinched 1.4× steps
 *  from 1× and never lands back on 1×. */
export function nextZoomPreset(
  zoom: number,
  direction: StepDirection,
  presets: readonly number[],
): number {
  if (presets.length === 0) return zoom
  let nearest = 0
  for (let index = 1; index < presets.length; index += 1) {
    if (Math.abs(presets[index] - zoom) < Math.abs(presets[nearest] - zoom)) nearest = index
  }
  const next = (nearest + direction + presets.length) % presets.length
  return presets[next]
}

/** The filter one step from `current`, wrapping. An unknown current id steps
 *  from the first filter. Up is the higher ordinal, as channel-up is the
 *  higher channel number. */
export function stepFilterId(
  ids: readonly string[],
  current: string,
  direction: StepDirection,
): string {
  if (ids.length === 0) return current
  const index = Math.max(0, ids.indexOf(current))
  return ids[(index + direction + ids.length) % ids.length]
}

/** 1-based position of a filter in the rail, for the readout between the
 *  arrows. Unknown → 1. */
export function filterOrdinal(ids: readonly string[], current: string): number {
  return Math.max(0, ids.indexOf(current)) + 1
}

/** The zoom as the readout between ◀ and ▶ says it: the preset chips' own
 *  spelling (.5× · 1× · 2×), and one decimal for anything the rocker or a
 *  pinch lands between them (1.4×). */
export function zoomReadout(zoom: number): string {
  if (!Number.isFinite(zoom) || zoom <= 0) return '1×'
  const rounded = Math.round(zoom * 10) / 10
  if (rounded < 1) return `.${Math.round(rounded * 10)}×`
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}×`
}
