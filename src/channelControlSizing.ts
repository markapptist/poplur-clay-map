export const CHANNEL_CONTROL_MAX_SIZE = 176
export const CHANNEL_CONTROL_MIN_SIZE = 124
export const MAP_SIDE_CONTROL_SIZE = 44
export const MAP_SIDE_CONTROL_GAP = 12
/** Extra breathing room before the visually dense domination-colour wheel. */
export const MAP_COLOR_CONTROL_GAP = 24

/**
 * Keep every channel-arrow pair on the same responsive scale as the persistent
 * navigator cube. Passing a width makes the helper deterministic in tests;
 * browser callers can omit it and use the current layout viewport.
 */
export function responsiveChannelControlSize(viewportWidth?: number): number {
  const width = viewportWidth
    ?? (typeof window === 'undefined' ? CHANNEL_CONTROL_MAX_SIZE / 0.37 : window.innerWidth)
  return Math.round(Math.min(
    CHANNEL_CONTROL_MAX_SIZE,
    Math.max(CHANNEL_CONTROL_MIN_SIZE, width * 0.37),
  ))
}

/** The authored artwork occupies 40.32% of the pair's long axis. */
export function channelControlImageSize(size: number): number {
  const shortAxis = Math.round(size / 2)
  return Math.round(Math.min(shortAxis, size * 0.42) * 0.96)
}

/**
 * The map's left rail is a fixed 44px control stack with 12px between items.
 * Use the same authored span for the opposite zoom rail so both columns start
 * and end on the same horizontal guides instead of drifting with viewport vh.
 */
export function mapSideControlRailSpan(controlCount: number): number {
  const count = Math.max(1, Math.round(controlCount))
  return count * MAP_SIDE_CONTROL_SIZE + (count - 1) * MAP_SIDE_CONTROL_GAP
}

/**
 * The colour wheel follows the ordinary map rail but needs a deliberate 24px
 * break after Weather. The opposite zoom rail uses this exact combined span,
 * keeping the two columns aligned even though that final gap is larger.
 */
export function mapSideControlRailWithColorSpan(baseControlCount: number): number {
  return mapSideControlRailSpan(baseControlCount)
    + MAP_COLOR_CONTROL_GAP
    + MAP_SIDE_CONTROL_SIZE
}
