import { describe, expect, it } from 'vitest'
import {
  GAME_CONTROLLER_REGIONS,
  gameControllerAxisAt,
  gameControllerDirection,
  gameControllerRegionAt,
  isGameControllerInputDetail,
} from '../gameControllerInput'

describe('PoplurStation 3D controller input', () => {
  it('maps the visible primary controls without overlapping their centres', () => {
    for (const region of GAME_CONTROLLER_REGIONS) {
      expect(gameControllerRegionAt(region.cx, region.cy)?.control).toBe(region.control)
    }
  })

  it('applies a dead zone and clamps stick axes', () => {
    const move = GAME_CONTROLLER_REGIONS.find(region => region.control === 'move')
    if (!move || move.kind !== 'axis') throw new Error('move region missing')
    expect(gameControllerAxisAt(move, move.cx, move.cy)).toEqual({ x: 0, y: 0 })
    const edge = gameControllerAxisAt(move, move.cx + move.rx * 2, move.cy - move.ry * 2)
    expect(edge.x).toBeGreaterThan(0)
    expect(edge.y).toBeGreaterThan(0)
    expect(Math.hypot(edge.x, edge.y)).toBeLessThanOrEqual(1.000001)
  })

  it('turns an analog pad into stable four-way retro input', () => {
    expect(gameControllerDirection(0, 0)).toBeNull()
    expect(gameControllerDirection(0.8, 0.2)).toBe('right')
    expect(gameControllerDirection(-0.8, 0.2)).toBe('left')
    expect(gameControllerDirection(0.1, 0.8)).toBe('up')
    expect(gameControllerDirection(0.1, -0.8)).toBe('down')
  })

  it('rejects malformed or out-of-range global events', () => {
    expect(isGameControllerInputDetail({
      source: 'poplurstation-3d', control: 'a', pressed: true,
    })).toBe(true)
    expect(isGameControllerInputDetail({
      source: 'poplurstation-3d', control: 'move', pressed: true, x: 3, y: 0,
    })).toBe(false)
    expect(isGameControllerInputDetail({
      source: 'something-else', control: 'fire', pressed: true,
    })).toBe(false)
  })
})
