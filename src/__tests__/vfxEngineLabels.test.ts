// @vitest-environment happy-dom
// A5: VFX Studio named Apple's SpriteKit and SceneKit on its tiles and timeline,
// on Android too, though every effect is the page's own canvas particles or
// WebGL model on both phones. The names people read are engine-neutral; the
// engine ids stay, because a post stores them (effectEngine).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VFX_EFFECTS } from '../VFXStudio'

const source = readFileSync(resolve(process.cwd(), 'src/VFXStudio.tsx'), 'utf8')

describe('VFX Studio labels', () => {
  it('never name an Apple framework', () => {
    const visible = source.replace(/^\s*\/\/.*$/gm, '')
    expect(visible).not.toMatch(/SpriteKit|SceneKit|SK EMITTER|SCN PARTICLE/)
    expect(VFX_EFFECTS.map(effect => effect.kind)).not.toContain('SK EMITTER')
  })

  it('keep the stored engine ids', () => {
    const engines = new Set(VFX_EFFECTS.map(effect => effect.engine))
    expect([...engines].sort()).toEqual(['none', 'scene3d', 'scenekit', 'spritekit'])
    expect(VFX_EFFECTS.filter(effect => effect.group === 'effects').every(effect => effect.kind === 'PARTICLES')).toBe(true)
  })
})
