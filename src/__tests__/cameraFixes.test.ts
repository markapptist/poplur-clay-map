import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dominantColorFromPixels } from '../brandAccent'

const read = (name: string) => readFileSync(resolve(process.cwd(), 'src', name), 'utf8')

describe('the roll shows the picture, not the thumbnail of it', () => {
  const roll = read('CameraRoll.tsx')
  const page = read('CameraRollScreen.tsx')

  it('hands the page a resolver, because the grid only holds thumbnails', () => {
    // onOpenItem used to return BEFORE pickItem's asset resolution, so opening
    // a library photo full screen painted the grid thumbnail stretched over the
    // whole stage. That is the blur.
    expect(roll).toContain('onOpenItem(items.indexOf(item), items, resolveFullAsset)')
    expect(roll).toContain('const resolveFullAsset = (')
  })

  it('keeps ONE owner for the native callbacks', () => {
    // The page cannot run its own resolver: window.poplurCameraRollAsset may
    // only ever be claimed once, which is why this is handed upward instead.
    expect(roll).toContain('w.poplurCameraRollAsset = payload =>')
    expect(page).not.toContain('poplurCameraRollAsset')
  })

  it('paints and posts the resolved asset, falling back to the thumbnail', () => {
    expect(page).toContain('src={fullSrc ?? viewerItem.fullSrc ?? viewerItem.src}')
    expect(page).toContain('src: fullSrc ?? viewerItem.fullSrc ?? viewerItem.src,')
  })

  it('abandons a slow fetch when you step to the next capture', () => {
    expect(page).toContain('return () => { live = false; abandon() }')
  })
})

describe('open media is actioned from the rail', () => {
  const page = read('CameraRollScreen.tsx')
  const review = read('CaptureReview.tsx')

  it('replaces the centred Post this pill with a rail', () => {
    // The pill and its centred row are gone; "Post this capture" survives only
    // as the rail button's accessible name, which is what it should say.
    expect(page).not.toContain('styles.rollViewerPost')
    expect(page).not.toContain('styles.rollViewerActions')
    expect(page).toContain('<TabControlRail side={controlSide} label="Capture controls">')
    expect(page).toContain('aria-label="Post this capture"')
  })

  it('gives the review three distinct exits on the rail', () => {
    expect(review).toContain('<TabControlRail side={controlSide} label="Review controls">')
    expect(review).not.toMatch(/>\s*Retake\s*</)
    expect(review).toContain('onKeep')
  })
})

describe('retake actually discards', () => {
  const camera = read('Camera.tsx')

  it('removes the rejected capture from the roll', () => {
    // Every capture route adds to the roll before the review opens, so without
    // this "retake" only ever meant "take another one as well".
    expect(camera).toContain('if (reviewCaptureId) removeCaptures([reviewCaptureId])')
  })

  it('remembers which roll entry the review is showing', () => {
    expect(camera).toContain('setReviewCaptureId(shot.id)')
    expect(camera).toContain('setReviewCaptureId(clip.id)')
  })
})

describe('the camera opens scanning', () => {
  const prefs = read('cameraPreferences.ts')
  const store = read('cameraStore.ts')

  it('defaults on, and only an explicit choice turns it off', () => {
    expect(prefs).toContain("window.localStorage.getItem(DETECT_KEY) !== '0'")
  })

  it('actually reads the preference, which it previously did not', () => {
    // The comment claimed the value came from settings while the line beneath
    // it hard-coded false, so the Settings toggle wrote a key nothing read.
    expect(store).toContain('let detectOn = readCameraDetectDefault()')
  })
})

describe('the focus square drives a real lens', () => {
  const camera = read('Camera.tsx')

  it('puts the sight up on a beat, centred, with a haptic', () => {
    expect(camera).toContain('const AUTO_REFOCUS_MS = 4_000')
    expect(camera).toContain('setFocusTap({ x: bounds.width / 2, y: bounds.height / 2, id: focusTapIdRef.current })')
    expect(camera).toContain('popHaptic()')
  })

  it('asks the shell to refocus rather than only drawing', () => {
    expect(camera).toContain("postNativeEvent({ type: 'cameraControl', control: 'refocus' })")
  })

  it('does not run against a parked or covered preview', () => {
    expect(camera).toContain('if (!effectiveLiveSurfaceVisible || nativePreviewParked) return')
    expect(camera).toContain('if (reviewMedia || composing) return')
  })
})

describe('recognition is confirmed in the hand', () => {
  const camera = read('Camera.tsx')

  it('fires on the EDGE of recognising, not every frame', () => {
    // Detections arrive many times a second; a haptic per frame is a rumble.
    expect(camera).toContain('lastRecognizedKeyRef')
    expect(camera).toContain('if (recognizedKey && recognizedKey !== lastRecognizedKeyRef.current)')
  })
})

describe('a scan card looks like what it found', () => {
  const window_ = read('CommerceSuggestionWindow.tsx')
  const dialogCss = read('PoplurDialog.module.css')

  it('takes its colour from the resolved creative', () => {
    expect(window_).toContain('brandAccentFromImage(creativeSrc)')
    expect(window_).toContain('accent={accent}')
  })

  it('names what was found instead of naming Poplur', () => {
    expect(window_).not.toContain('eyebrow="POPLUR AD"')
  })

  it('still says it is an ad', () => {
    // Brand colours must not buy away the disclosure.
    expect(window_).toContain("{ icon: '🛍', text: 'Sponsored' }")
  })

  it('falls back to the house pink when no colour can be read', () => {
    expect(dialogCss).toContain("var(--dialogAccent, #ff2f91)")
  })

  it('picks a colour that carries, not the average of the picture', () => {
    // A flat red block with a few dark pixels: averaging returns mud, so the
    // extractor has to return the red.
    const pixels = new Uint8ClampedArray(4 * 100)
    for (let i = 0; i < 100; i++) {
      const at = i * 4
      const red = i < 80
      pixels[at] = red ? 220 : 10
      pixels[at + 1] = red ? 30 : 10
      pixels[at + 2] = red ? 30 : 10
      pixels[at + 3] = 255
    }
    const colour = dominantColorFromPixels(pixels)
    expect(colour).toMatch(/^#[0-9a-f]{6}$/)
    const r = parseInt(colour!.slice(1, 3), 16)
    const g = parseInt(colour!.slice(3, 5), 16)
    expect(r).toBeGreaterThan(180)
    expect(g).toBeLessThan(80)
  })

  it('returns null rather than guessing on a colourless picture', () => {
    const grey = new Uint8ClampedArray(4 * 50)
    for (let i = 0; i < 50; i++) {
      const at = i * 4
      grey[at] = grey[at + 1] = grey[at + 2] = 128
      grey[at + 3] = 255
    }
    expect(dominantColorFromPixels(grey)).toBeNull()
  })
})

describe('blocking is a decision about a person', () => {
  const feed = read('FeedTwin.tsx')
  const profile = read('ProfileTwin.tsx')

  it('is gone from the feed entirely', () => {
    expect(feed).not.toContain('data-feed-block')
    expect(feed).not.toContain('blockPromptPost')
    expect(feed).not.toContain('canBlockPoster')
  })

  it('still HONOURS blocks on the feed', () => {
    // Removing the control must not stop the feed filtering blocked posters.
    expect(feed).toContain('isUserBlocked')
  })

  it('still lives on the profile', () => {
    expect(profile).toContain('blockPrompt')
  })
})
