import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CLAY_MODELS_PACK } from '../modelUrl'

const CONSOLE_MODEL = 'games/poplurstation/console.glb'

describe('Poplur Station console model routing', () => {
  it('routes the cloud-packed boot model through the shared model URL seam', () => {
    expect(CLAY_MODELS_PACK.has(CONSOLE_MODEL)).toBe(true)
    expect(existsSync(new URL(`../../public/${CONSOLE_MODEL}`, import.meta.url))).toBe(true)

    const source = readFileSync(new URL('../StationBootModel.tsx', import.meta.url), 'utf8')
    expect(source).toContain("const STATION_CONSOLE_MODEL = 'games/poplurstation/console.glb'")
    expect(source).toContain('modelUrl(STATION_CONSOLE_MODEL)')
    expect(source).not.toMatch(/loader\.load\(\s*['"]games\/poplurstation\/console\.glb['"]/)
  })
})
