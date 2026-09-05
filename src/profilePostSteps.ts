// ── Walking a profile's grid from inside an opened post ──────────────────────
//
// The media grid is three columns, filled row by row, and the opened post is
// the flat index of its tile. So "next" and "previous" are ±1 along the flat
// order (the tile to the right, wrapping onto the next row at the edge), and
// "above" and "below" are ±one row — the tile in the same column one row up
// or down. A step that would leave the grid does not exist: it is null, and
// the arrow for it is disabled rather than wrapping to the other end, so the
// four arrows always read as directions on the grid you just came from.

export const PROFILE_GRID_COLUMNS = 3

export type ProfilePostStepDirection = 'left' | 'right' | 'up' | 'down'

export interface ProfilePostStepAvailability {
  left: boolean
  right: boolean
  up: boolean
  down: boolean
}

/** The flat index the step lands on, or null when no such tile exists. */
export function stepProfilePostIndex(
  index: number,
  count: number,
  direction: ProfilePostStepDirection,
  columns: number = PROFILE_GRID_COLUMNS,
): number | null {
  if (!Number.isInteger(index) || !Number.isInteger(count)) return null
  if (count <= 0 || index < 0 || index >= count) return null
  const stride = Math.max(1, Math.floor(columns))
  let next: number
  switch (direction) {
    case 'left': next = index - 1; break
    case 'right': next = index + 1; break
    case 'up': next = index - stride; break
    case 'down': next = index + stride; break
  }
  return next >= 0 && next < count ? next : null
}

export function profilePostStepAvailability(
  index: number,
  count: number,
  columns: number = PROFILE_GRID_COLUMNS,
): ProfilePostStepAvailability {
  return {
    left: stepProfilePostIndex(index, count, 'left', columns) != null,
    right: stepProfilePostIndex(index, count, 'right', columns) != null,
    up: stepProfilePostIndex(index, count, 'up', columns) != null,
    down: stepProfilePostIndex(index, count, 'down', columns) != null,
  }
}
