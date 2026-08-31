import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setPendingMapPost, takePendingMapPost } from '../cameraStore'

function source(relative: string): string {
  return readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')
}

describe('camera AI upload pipeline contract', () => {
  it('parks the chosen AI pixels separately from the restorable original', () => {
    setPendingMapPost({
      media: { kind: 'photo', src: 'data:image/jpeg;base64,ai' },
      originalMedia: { kind: 'photo', src: 'data:image/jpeg;base64,original' },
      caption: '',
      channelId: 'food',
      filterId: 'none',
      usedAI: true,
    })

    const pending = takePendingMapPost()
    expect(pending?.media.src).toBe('data:image/jpeg;base64,ai')
    expect(pending?.originalMedia?.src).toBe('data:image/jpeg;base64,original')
    expect(pending?.usedAI).toBe(true)
  })

  it('uses the real capture or a bounded recording frame and releases every request state', () => {
    const composer = source('PostComposer.tsx')

    expect(composer).toContain("const sourceAsset = baselineMedia.kind === 'photo' ? baselineMedia.src : previewStill")
    expect(composer).toContain('sourceImage,')
    expect(composer).toContain('signal: controller.signal')
    expect(composer).toContain('aiRequestRef.current?.abort()')
    expect(composer).toContain('}).finally(() => {')
    expect(composer).toContain('setAiGenerating(false)')
    expect(composer).toContain('materializeAIGeneratedImage(result.outputUrl as string)')
    expect(composer).toContain('aiImageSourceDataURL(result.inlineAsset)')
    expect(composer).toContain('setSelectedAIMedia(selectedMedia)')
    expect(composer).toContain('continueAfterFinish(selectedMedia, true)')
    expect(composer).toContain('media: selectedMedia')
    expect(composer).toContain('originalMedia: baselineMedia')
    expect(composer).not.toMatch(/if \(reviewMode\) \{[\s\S]{0,180}continueAfterFinish\(\)/)
  })

  it('presents two truthful paths and requires explicit acceptance of an AI preview', () => {
    const composer = source('PostComposer.tsx')
    const chat = source('ComposerAIChat.tsx')
    const css = source('ComposerAIChat.module.css')

    expect(chat).toContain('Use original')
    expect(chat).toContain('Generate AI preview')
    expect(chat).toContain('Use AI version')
    expect(chat).toContain('Nothing changes until you choose.')
    expect(chat).not.toContain('Cut it like a music video')
    expect(css).toContain('.mediaRowCompare')
    expect(css).toContain('.originalAction')
    expect(composer).toContain('const media = selectedAIMedia ?? baselineMedia')
    expect(composer).toContain('continueAfterFinish(baselineMedia, false)')
    expect(composer).toContain('setAiCandidate(null)')
  })

  it('keeps filters and VFX optional instead of making them upload gates', () => {
    const composer = source('PostComposer.tsx')
    const chat = source('ComposerAIChat.tsx')

    expect(composer).toContain("initialStep ?? 'finish'")
    expect(composer).toContain("goToStep('finish')")
    expect(chat).toContain('Filters, trim &amp; VFX')
    expect(composer).toContain("goToStep('edit')")
  })

  it('uses one cube-navigation pop when the persistent navigator changes model', () => {
    const composer = source('PostComposer.tsx')

    expect(composer).toContain("import { playCubeNavigationPop } from './cubeNavigationSound'")
    expect(composer).toContain("onClick={() => { playCubeNavigationPop(); goToStep('finish') }}")
    expect(composer).toContain("onContinue={() => { playCubeNavigationPop(); goToStep('finish') }}")
    expect(composer).toMatch(/onEditTools=\{\(\) => \{\s*playCubeNavigationPop\(\)\s*goToStep\('edit'\)/)
    expect(composer).toContain("onClick={() => { playPop(); goToStep('effects') }}")
  })

  it('does not let the persistent arrows mutate hidden filters on the choice screen', () => {
    const composer = source('PostComposer.tsx')

    expect(composer).toContain("if (stepRef.current !== 'edit') return")
    expect(composer).not.toMatch(/bindArrows\(\(dir:[\s\S]*?playPop\(\)[\s\S]*?return \(\) => bindArrows\(null\)/)
  })

  it('waits for a real video frame and keeps completion accessible', () => {
    const composer = source('PostComposer.tsx')
    const chat = source('ComposerAIChat.tsx')
    const css = source('ComposerAIChat.module.css')

    expect(composer).toContain("const videoAIFrameReady = baselineMedia.kind !== 'video' || Boolean(previewStill)")
    expect(chat).toContain('disabled={!prompt.trim() || generating || !aiSourceReady}')
    expect(chat).toContain('ref={candidateActionRef}')
    expect(chat).toContain('aria-live="polite"')
    expect(chat).toContain('className={styles.srOnly}')
    expect(css).toContain('.srOnly')
  })

  it('shows the same selected filter treatment that publish will bake', () => {
    const composer = source('PostComposer.tsx')
    const chat = source('ComposerAIChat.tsx')

    expect(composer).toContain("mediaFilter={filterCss === 'none' ? undefined : filterCss}")
    expect(chat).toContain('style={mediaFilter ? { filter: mediaFilter } : undefined}')
  })
})
