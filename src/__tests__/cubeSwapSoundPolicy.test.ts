import { describe, expect, it } from 'vitest'
import { cubeSwapShouldPlaySound } from '../cubeSwapSoundPolicy'

describe('cube swap sound policy', () => {
  it('keeps the normal pop for every ordinary non-wheel model swap', () => {
    expect(cubeSwapShouldPlaySound({
      wheelFocused: false,
      activeTab: 'feed',
      previousEventSignal: 'none',
      nextEventSignal: 'music',
    })).toBe(true)
  })

  it.each([
    ['airport:pearson', 'none'],
    ['airport:pearson', 'map-hover:land:globe'],
    ['country:1720000000000', 'map-hover:water:globe'],
    ['map-news:active:parade', 'none'],
    ['map-reward:dice:1720000000000', 'map-hover:land:globe'],
    ['map-reward:dice:1720000000000', 'none'],
    ['snow', 'none'],
    ['map-hover:water:boat', 'map-hover:water:globe'],
  ])('pops a Map return from %s to %s even while the wheel is focused', (previous, next) => {
    expect(cubeSwapShouldPlaySound({
      wheelFocused: true,
      activeTab: 'map',
      previousEventSignal: previous,
      nextEventSignal: next,
    })).toBe(true)
  })

  it('does not add a second sound to an ordinary focused-wheel preview', () => {
    expect(cubeSwapShouldPlaySound({
      wheelFocused: true,
      activeTab: 'profile',
      previousEventSignal: 'none',
      nextEventSignal: 'none',
    })).toBe(false)
  })
})
