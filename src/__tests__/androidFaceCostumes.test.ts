// A5: face costumes on Android. Android's faces now carry iOS's pose and eye
// line, the costume keeps drawing for as long as a face is in frame (it slept
// with the ambient lane, for good on the A03), and a tier-low viewfinder keeps
// the colour of its grade without the passes that cost the A03 its frames.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { arFilterCatalog, arFilterLiteCss } from '../arFilterCatalog'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const entry = (id: string) => arFilterCatalog().filters.find(filter => filter.id === id)

describe('the tier-low viewfinder grade', () => {
  it('keeps the colour and drops blur, drop-shadow and the anaglyph pass', () => {
    expect(arFilterLiteCss(entry('smooth-glow'))).toBe('brightness(1.07) contrast(1.05) saturate(1.06)')
    expect(arFilterLiteCss(entry('pop-3d'))).toBe('saturate(1.1)')
    expect(arFilterLiteCss(entry('angel'))).toBe('brightness(1.24) contrast(0.94) saturate(1.05)')
    expect(arFilterLiteCss(entry('retro-vhs'))).toBe(entry('retro-vhs')!.css)
    expect(arFilterLiteCss(entry('none'))).toBe('none')
    expect(arFilterLiteCss(undefined)).toBe('none')
  })

  it('never carries an expensive pass for any published filter', () => {
    for (const filter of arFilterCatalog().filters) {
      expect(arFilterLiteCss(filter)).not.toMatch(/blur|drop-shadow|url\(/)
    }
  })

  it('outranks the flattening rule on the viewfinder only', () => {
    const css = read('src/index.css')
    expect(css).toContain('.tier-low video[data-poplur-grade] {\n  filter: var(--poplur-live-grade-lite, none) !important;')
    const camera = read('src/Camera.tsx')
    expect(camera).toContain("data-poplur-grade={filterLiteCss === 'none' ? undefined : ''}")
    expect(camera).toContain("'--poplur-live-grade-lite': filterLiteCss")
  })
})

describe('the costume', () => {
  const faceAR = read('src/FaceAR3D.tsx')

  it('draws on the managed lane, renewed while a face is in frame', () => {
    expect(faceAR).toContain("stopFrames = onFrame(frame, 'managed')")
    expect(faceAR).not.toContain("onFrame(frame, 'ambient')")
    expect(faceAR).toContain('sustainManagedRendering(FACE_TRACK_LEASE_MS)')
  })

  it('gets iOS\'s pose and eye line from Android', () => {
    const activity = read('../Poplur2025-Android/app/src/main/java/com/apptists/poplur2025/PostLoginWebActivity.kt')
    expect(activity).toContain('.setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)')
    expect(activity).toContain('put("roll", com.apptists.poplur2025.ml.CameraFacePose.roll(face.headEulerAngleZ, mirrored))')
    expect(activity).toContain('put("yaw", com.apptists.poplur2025.ml.CameraFacePose.yaw(face.headEulerAngleY, mirrored))')
    for (const name of ['leftEye', 'rightEye', 'nose']) expect(activity).toContain(`"${name}" to com.google.mlkit.vision.face.FaceLandmark.`)
    // FaceAR3D reads Vision's roll sign, which it negates.
    expect(faceAR).toContain('roll: -(face.roll ?? 0),')
  })
})
