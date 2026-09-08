import { describe, expect, it } from 'vitest'
import { buildingDayMaterial, buildingDayPalette, BUILDING_LOOKS } from '../buildingDayStyle'
import { skySchedule, skyShadeAt } from '../skyCycle'

describe('buildings following the sky clock', () => {
  it.each([0, 5, 8, 11])('visits all five looks in month %i, including across midnight', month => {
    const date = new Date(2026, month, 15)
    const phases = skySchedule(date)
    const expected = ['midnight', 'terracotta', 'original', 'porcelain', 'porcelain', 'candy', 'candy', 'midnight', 'midnight']
    phases.forEach((phase, index) => {
      const [hour, minute] = phase.startsAt.split(':').map(Number)
      const when = new Date(date)
      when.setHours(hour, minute + 25)
      expect(buildingDayPalette(skyShadeAt(when)).look).toBe(expected[index])
    })
    const before = new Date(2026, month, 15, 23, 59)
    const after = new Date(2026, month, 16, 0, 1)
    expect(buildingDayPalette(skyShadeAt(before))).toEqual(buildingDayPalette(skyShadeAt(after)))
  })

  it('blends colours gradually through boundaries rather than switching entire palettes', () => {
    let previous: string[] | undefined
    let blendedSamples = 0
    for (let minute = 0; minute < 1440; minute++) {
      const palette = buildingDayPalette(skyShadeAt(new Date(2026, 8, 8, 0, minute)))
      const colors = [...palette.colors, palette.roof]
      if (previous) colors.forEach((color, index) => {
        for (const offset of [1, 3, 5]) {
          const delta = Math.abs(parseInt(color.slice(offset, offset + 2), 16)
            - parseInt(previous![index].slice(offset, offset + 2), 16))
          expect(delta).toBeLessThanOrEqual(16)
        }
      })
      if (!Object.values(BUILDING_LOOKS).some(look => look.colors.every((color, index) => color === palette.colors[index]))) blendedSamples++
      previous = colors
    }
    expect(blendedSamples).toBeGreaterThan(60)
  })

  it('holds the same paint outside transitions and safely handles nonnumeric building IDs', () => {
    const first = skyShadeAt(new Date(2026, 8, 8, 12, 0))
    const later = skyShadeAt(new Date(2026, 8, 8, 12, 30))
    expect(first.key).toBe(later.key)
    expect(buildingDayMaterial(first)).toEqual(buildingDayMaterial(later))
    const paint = buildingDayMaterial(first) as unknown[]
    expect(paint[1]).toEqual(['%', ['floor', ['+', ['to-number', ['id'], 0],
      ['*', ['to-number', ['get', 'height'], 8], 3]]], 6])
    expect(buildingDayMaterial(first, true)).toMatch(/^#[0-9a-f]{6}$/)
  })
})
