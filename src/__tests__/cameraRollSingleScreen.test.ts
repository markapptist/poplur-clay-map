// There were two Camera Rolls. This screen — the one with the camera-roll cube,
// selection, deletion and preview — and a second page of the camera's own pager
// that `onOpenRoll` stepped to. Which one you got depended on which control you
// pressed: the arrows reached this screen, the camera's roll button reached the
// pager. They must be the same screen from every entrance.
//
// The pager also kept the viewfinder mounted underneath, so the shutter stayed
// live behind a library you were browsing.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CAMERA_CYCLE_SCREEN, CAMERA_HOLD_MENU_ITEMS } from '../cameraNavigation'

const home = readFileSync(new URL('../HomeTwin.tsx', import.meta.url), 'utf8')
const camera = readFileSync(new URL('../Camera.tsx', import.meta.url), 'utf8')

describe('the Camera Roll is one screen', () => {
  it('routes every entrance through a single opener', () => {
    expect(home).toContain('const openCameraRollScreen = useCallback(')
    // The camera's own roll button and the wheel's ROLL action.
    expect(home).toContain('onOpenRoll={openCameraRollScreen}')
    expect(home).toMatch(/if \(action === 'roll'\) \{\s*openCameraRollScreen\(\)/)
  })

  it('never opens the roll by stepping the camera pager', () => {
    // The old shape. Any of these coming back means a second roll came back.
    expect(home).not.toContain('onOpenRoll={() => setCameraStep(s => s + 1)}')
    expect(home).not.toMatch(/if \(action === 'roll'\) \{\s*setCameraStep/)
  })

  it('boots the harness ?view=cameraroll route into that same screen', () => {
    expect(home).toContain("initialCameraPage === 'roll' ? 'camera-roll'")
    expect(home).toContain("initialCameraPage === 'roll')")
  })

  it('agrees with the arrow ring and the hold wheel on the screen id', () => {
    expect(CAMERA_CYCLE_SCREEN.roll).toBe('camera-roll')
    expect(CAMERA_HOLD_MENU_ITEMS.find(i => i.screen === 'camera-roll')).toBeDefined()
  })
})

describe('the shutter is disarmed while a capture is being reviewed', () => {
  // liveSurfaceVisible deliberately stays true through review so discarding
  // returns to a warm camera, which is why review needs its own guard.
  it('tracks the review state in a ref', () => {
    expect(camera).toContain('const reviewingRef = useRef(false)')
    expect(camera).toContain('reviewingRef.current = reviewMedia != null')
  })

  it('blocks a photo capture during review', () => {
    expect(camera).toContain('if (!liveSurfaceVisible || composingRef.current || reviewingRef.current) return')
  })

  it('blocks starting a recording during review, while still allowing a stop', () => {
    expect(camera).toMatch(
      /if \(\(page !== 'live' \|\| composingRef\.current \|\| reviewingRef\.current\)\s*\n\s*&& !nativeRecordingRef\.current\s*\n\s*&& !recorderRef\.current\) return/,
    )
  })
})
