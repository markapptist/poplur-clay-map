import { describe, expect, it } from 'vitest'
import {
  CLOSE_PROGRAMMATIC_CAMERA_MIN_ZOOM,
  programmaticCameraBlurAllowed,
  programmaticCameraPlan,
} from '../programmaticCameraMotion'

describe('programmatic Map camera motion', () => {
  it('translates at the current zoom when the destination frame is closer', () => {
    expect(programmaticCameraPlan(15.4, 17.6)).toEqual({
      kind: 'translate',
      zoom: 15.4,
    })
  })

  it('never lowers an already-close camera while translating', () => {
    expect(programmaticCameraPlan(19.2, 16.7)).toEqual({
      kind: 'translate',
      zoom: 19.2,
    })
  })

  it('retains the staged crossing for a genuinely wide starting camera', () => {
    expect(programmaticCameraPlan(
      CLOSE_PROGRAMMATIC_CAMERA_MIN_ZOOM - 0.1,
      17.6,
    )).toEqual({ kind: 'staged', zoom: 17.6 })
  })

  it('does not convert an explicitly wide destination into a close move', () => {
    expect(programmaticCameraPlan(18, 8)).toEqual({ kind: 'staged', zoom: 8 })
  })

  it('never enables decorative blur for reduced-motion users', () => {
    expect(programmaticCameraBlurAllowed(false)).toBe(true)
    expect(programmaticCameraBlurAllowed(true)).toBe(false)
  })
})
