import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isKeyboardCameraRollClick } from '../cameraControlActivation'

describe('camera-roll side control', () => {
  it('separates immediate pointer activation from the keyboard click fallback', () => {
    expect(isKeyboardCameraRollClick(0)).toBe(true)
    expect(isKeyboardCameraRollClick(1)).toBe(false)
    expect(isKeyboardCameraRollClick(2)).toBe(false)
  })

  it('keeps the control clickable and recovers from stale thumbnails', () => {
    const source = readFileSync(resolve(process.cwd(), 'src', 'Camera.tsx'), 'utf8')
    expect(source).toContain('aria-label="Open camera roll"')
    expect(source).toContain('onPointerDown={event => {')
    expect(source).toContain('if (event.isPrimary) openCameraRoll()')
    expect(source).toContain('onError={() => setRollPreviewFailed(true)}')
    expect(source).toContain("(arOpen ? 'pan-x' : 'none')")
  })

  it('keeps the camera-roll wrapper neutral instead of drawing shaded chrome', () => {
    const css = readFileSync(resolve(process.cwd(), 'src', 'ViewHarness.module.css'), 'utf8')
    const rule = css.match(/\.camRollBtn \{([\s\S]*?)\n\}/)?.[1] ?? ''

    expect(rule).toContain('border: 0;')
    expect(rule).toContain('background: transparent;')
    expect(rule).toContain('backdrop-filter: none;')
    expect(rule).toContain('box-shadow: none;')
    expect(css).not.toContain('camRollShaderSweep')
    expect(css).not.toContain('.camRollBtn::after')
  })
})
