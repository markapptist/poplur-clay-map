export type CameraPadding = { top: number; right: number; bottom: number; left: number }

/** Native anchor is a zoom/rotation pivot, not GL's destination offset.
 * Translate destination framing into a padded principal point instead, so
 * the requested geographic centre survives flights between landmarks. */
export function nativeCameraPadding(base: CameraPadding, offset: readonly number[] | undefined): CameraPadding {
  const [x, y] = offset ?? [0, 0]
  return {
    top: base.top + Math.max(0, y * 2),
    bottom: base.bottom + Math.max(0, -y * 2),
    left: base.left + Math.max(0, x * 2),
    right: base.right + Math.max(0, -x * 2),
  }
}
