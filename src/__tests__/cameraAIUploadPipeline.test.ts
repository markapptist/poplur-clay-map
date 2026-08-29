import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(relative: string): string {
  return readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')
}

describe('camera AI upload pipeline contract', () => {
  it('uses the real capture or a bounded recording frame and releases every request state', () => {
    const composer = source('PostComposer.tsx')

    expect(composer).toContain("const sourceAsset = media.kind === 'photo' ? media.src : previewStill")
    expect(composer).toContain('sourceImage,')
    expect(composer).toContain('signal: controller.signal')
    expect(composer).toContain('aiRequestRef.current?.abort()')
    expect(composer).toContain('}).finally(() => {')
    expect(composer).toContain('setAiGenerating(false)')
    expect(composer).toContain('You can use this edit now or try AI again shortly.')
  })

  it('keeps every AI idea visible instead of clipping a horizontal strip', () => {
    const chat = source('ComposerAIChat.tsx')
    const css = source('ComposerAIChat.module.css')

    expect(chat).toContain("media.kind === 'photo'")
    expect(chat).toContain('One bounded frame will guide this edit')
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    expect(css).not.toContain('.ideas { display: flex')
  })
})
