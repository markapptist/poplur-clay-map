import { describe, expect, it } from 'vitest'
import { PROFILE_GRID_COLUMNS, profilePostStepAvailability, stepProfilePostIndex } from '../profilePostSteps'

describe('stepping through a profile grid from an opened post', () => {
  it('walks left and right along reading order, wrapping rows at the edge but never the grid', () => {
    // 7 tiles in 3 columns:  0 1 2 / 3 4 5 / 6
    expect(stepProfilePostIndex(0, 7, 'left')).toBeNull()
    expect(stepProfilePostIndex(0, 7, 'right')).toBe(1)
    expect(stepProfilePostIndex(2, 7, 'right')).toBe(3)
    expect(stepProfilePostIndex(3, 7, 'left')).toBe(2)
    expect(stepProfilePostIndex(6, 7, 'right')).toBeNull()
  })

  it('walks up and down one row in the same column, only where a tile exists', () => {
    expect(PROFILE_GRID_COLUMNS).toBe(3)
    expect(stepProfilePostIndex(0, 7, 'down')).toBe(3)
    expect(stepProfilePostIndex(3, 7, 'down')).toBe(6)
    expect(stepProfilePostIndex(4, 7, 'down')).toBeNull() // nothing under column 2 on row 3
    expect(stepProfilePostIndex(6, 7, 'up')).toBe(3)
    expect(stepProfilePostIndex(1, 7, 'up')).toBeNull()
  })

  it('reports which arrows have somewhere to go', () => {
    expect(profilePostStepAvailability(0, 7)).toEqual({ left: false, right: true, up: false, down: true })
    expect(profilePostStepAvailability(4, 7)).toEqual({ left: true, right: true, up: true, down: false })
    expect(profilePostStepAvailability(6, 7)).toEqual({ left: true, right: false, up: true, down: false })
    expect(profilePostStepAvailability(0, 1)).toEqual({ left: false, right: false, up: false, down: false })
  })

  it('refuses an index that is not a tile', () => {
    expect(stepProfilePostIndex(-1, 7, 'right')).toBeNull()
    expect(stepProfilePostIndex(7, 7, 'left')).toBeNull()
    expect(stepProfilePostIndex(0, 0, 'right')).toBeNull()
    expect(stepProfilePostIndex(1.5, 7, 'right')).toBeNull()
  })
})
