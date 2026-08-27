/** Fixed layout contract shared by the native-scrolling AR rail and tests. */
export const AR_FILTER_SLOT_SPACING = 78

export function clampARFilterIndex(index: number, count: number): number {
  if (count <= 0 || !Number.isFinite(index)) return 0
  return Math.max(0, Math.min(count - 1, Math.round(index)))
}

export function arFilterScrollLeft(index: number): number {
  return Math.max(0, index) * AR_FILTER_SLOT_SPACING
}

export function nearestARFilterIndex(scrollLeft: number, count: number): number {
  return clampARFilterIndex(Math.max(0, scrollLeft) / AR_FILTER_SLOT_SPACING, count)
}
