/**
 * Mapbox anchors the full transparent sprite canvas, not the visible model.
 * Move a grounded sprite down by its proportional transparent bottom gutter so
 * the model's visible floor, rather than the canvas edge, meets the coordinate.
 */
export function visibleBaseOffsetPx(
  renderedWidthPx: number,
  transparentBottomPx: number,
  sourceCanvasPx = 256,
): number {
  if (!Number.isFinite(renderedWidthPx) || renderedWidthPx <= 0) return 0
  if (!Number.isFinite(transparentBottomPx) || transparentBottomPx <= 0) return 0
  if (!Number.isFinite(sourceCanvasPx) || sourceCanvasPx <= 0) return 0
  return Math.round(renderedWidthPx * transparentBottomPx / sourceCanvasPx)
}

export const GROUNDED_SPRITE_BOTTOM_GUTTER = {
  palm: 51,
  boat: 63,
  settlement: 38,
} as const
