import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Studio music credential boundary', () => {
  it('uses a Poplur server endpoint and never embeds a provider credential', () => {
    const studio = readFileSync(resolve(process.cwd(), 'src', 'StudioScreen.tsx'), 'utf8')
    expect(studio).toContain('VITE_POPLUR_MUSIC_ENDPOINT')
    expect(studio).not.toContain('VITE_ELEVENLABS_KEY')
    expect(studio).not.toContain('xi-api-key')
    expect(studio).not.toContain('api.elevenlabs.io')
  })

  it('does not serialize the complete Vite environment into wardrobe chunks', () => {
    const wardrobeAssets = readFileSync(
      resolve(process.cwd(), 'src', 'wardrobe', 'wardrobeAssets.ts'),
      'utf8',
    )
    expect(wardrobeAssets).toContain('import.meta.env.BASE_URL')
    expect(wardrobeAssets).not.toContain('(import.meta as')
  })
})
