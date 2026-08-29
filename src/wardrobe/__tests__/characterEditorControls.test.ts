import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Wardrobe character studio controls', () => {
  it('exposes an explicit close control and starts with the selected outfit fitting', () => {
    const editor = readFileSync(resolve(process.cwd(), 'src', 'CharacterEditor.tsx'), 'utf8')
    const renderer = readFileSync(resolve(process.cwd(), 'src', 'ThreeAvatarStudio.tsx'), 'utf8')
    expect(editor).toContain("aria-label='Close character studio'")
    expect(editor).toContain('closeStudio()')
    expect(renderer).toContain("data-avatar-outfit-state={outfitReady ? 'ready' : 'fitting'}")
    expect(renderer).toContain('Fitting selected outfit…')
  })

  it('keeps the wardrobe native while the external fitted provider is parked', () => {
    const editor = readFileSync(resolve(process.cwd(), 'src', 'CharacterEditor.tsx'), 'utf8')
    expect(editor).not.toContain('FittedAvatarWardrobe')
    expect(editor).not.toContain('fittedWardrobeButton')
    expect(editor).not.toContain('poplur.wardrobe.provider.v1')
  })

  it('settles readiness after every synchronous procedural garment fallback', () => {
    const renderer = readFileSync(resolve(process.cwd(), 'src', 'ThreeAvatarStudio.tsx'), 'utf8')
    const loadGarment = renderer.slice(
      renderer.indexOf('runtime.loadGarment ='),
      renderer.indexOf('const handle: PoplurAvatarHandle'),
    )
    const settledFallbacks = loadGarment.match(
      /syncProceduralOutfitSlot\([^\n]+\)\s*options\.onModelLoaded\?\.\(slotName\)\s*return/g,
    ) ?? []
    expect(settledFallbacks).toHaveLength(3)
  })
})
