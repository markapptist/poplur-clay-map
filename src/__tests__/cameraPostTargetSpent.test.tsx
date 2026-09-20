// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Camera from '../Camera'
import { clearPendingMapPost, setPendingMapPost } from '../cameraStore'

// The composer under test is the hand-off, not the form: a stub that shows
// which spot it was handed and can report a published pop the way the real
// composer does.
vi.mock('../PostComposer', () => ({
  default: ({ target, onPosted }: {
    target?: { lat: number; lng: number; resume?: boolean }
    onPosted?: (post: { target?: { lat: number; lng: number } }) => void
  }) => (
    <div role="dialog" aria-label="Post composer" data-target-lat={target?.lat ?? ''} data-target-resume={String(Boolean(target?.resume))}>
      <button type="button" onClick={() => onPosted?.({ target })}>Post to News Feed</button>
    </div>
  ),
}))
vi.mock('../CameraRoll', () => ({ default: () => null }))
vi.mock('../CaptureReview', () => ({ default: () => null }))
vi.mock('../CameraARRail', () => ({ default: () => null }))
vi.mock('../FaceAROverlay', () => ({ default: () => null, drawFaceAREffect: vi.fn(), hasCaptureCostume: () => false }))
vi.mock('../RecognitionAura', () => ({ default: () => null }))
vi.mock('../CameraFocusSquare', () => ({ default: () => null }))
vi.mock('../mlDetect', () => ({ FrameDetector: class { reset() {} detect() { return [] } }, faceIdEnabled: () => false }))
vi.mock('../voiceAudio', () => ({ cancelVoiceSpeech: vi.fn(), speakWithVoiceAudioFocus: vi.fn() }))
vi.mock('../pop', () => ({ playPop: vi.fn(), popHaptic: vi.fn(), primePopAudio: vi.fn() }))
vi.mock('../nativeBridge', async importOriginal => ({ ...await importOriginal<typeof import('../nativeBridge')>(), isNativeShell: () => false, postNativeEvent: vi.fn() }))
vi.mock('../useClaimRadiusLimit', () => ({ useClaimRadiusLimitKm: () => 100 }))

const media = { kind: 'photo' as const, src: 'data:image/jpeg;base64,fixture' }
const draft = { media, caption: 'Second pop', channelId: 'food', filterId: 'none', usedAI: false, rightsAttested: true }
const spot = { lat: 43.65, lng: -79.38, radiusKm: 5 }

const composer = () => document.querySelector<HTMLElement>('[aria-label="Post composer"]')

let root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers()
  clearPendingMapPost()
  const host = document.createElement('main')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  vi.useRealTimers()
  clearPendingMapPost()
  document.body.innerHTML = ''
})

describe('a picked spot is spent with the composer that held it', () => {
  it('spends a resumed spot when a posted pop unmounts the camera before the composer closes', () => {
    // Camera-first: the draft parked for the map picker comes back with the
    // spot the picker answered, tagged `resume`.
    setPendingMapPost(draft)
    const onPostTargetUsed = vi.fn()
    act(() => root.render(<Camera postTarget={{ ...spot, resume: true }} onPosted={vi.fn()} onPostTargetUsed={onPostTargetUsed} />))
    expect(composer()?.dataset.targetLat).toBe(String(spot.lat))
    expect(composer()?.dataset.targetResume).toBe('true')
    expect(onPostTargetUsed).not.toHaveBeenCalled()

    // Publishing hands the pop up; HomeTwin's onPosted then ends the trip on
    // the Map tab, which unmounts the camera with the composer still up — its
    // own onClose never runs. This is the path that left the spot armed for
    // the next capture.
    act(() => composer()!.querySelector('button')!.click())
    act(() => root.unmount())
    root = createRoot(document.body.appendChild(document.createElement('main')))
    expect(onPostTargetUsed).toHaveBeenCalledTimes(1)

    // Once HomeTwin has dropped the target, the next capture on this camera is
    // camera-first again: no composer opens on its own, and nothing is left
    // over to hand the next composer a spot.
    act(() => root.render(<Camera postTarget={null} onPosted={vi.fn()} onPostTargetUsed={onPostTargetUsed} />))
    expect(composer()).toBeNull()
  })

  it('spends the spot when the camera is left mid-draft', () => {
    setPendingMapPost(draft)
    const onPostTargetUsed = vi.fn()
    act(() => root.render(<Camera postTarget={{ ...spot, resume: true }} onPostTargetUsed={onPostTargetUsed} />))
    expect(composer()).not.toBeNull()
    // A tab switch with the composer open loses the draft with the camera; the
    // spot must not outlive the draft it was picked for.
    act(() => root.unmount())
    root = createRoot(document.body.appendChild(document.createElement('main')))
    expect(onPostTargetUsed).toHaveBeenCalledTimes(1)
  })

  it('keeps a map-first spot that no composer holds yet', () => {
    // Map "Post here" arms the camera before any capture. The camera-permission
    // card unmounts the camera on first use; the spot has to survive that so
    // the capture that follows still lands where the map was tapped.
    const onPostTargetUsed = vi.fn()
    act(() => root.render(<Camera postTarget={spot} onPostTargetUsed={onPostTargetUsed} />))
    expect(composer()).toBeNull()
    act(() => root.unmount())
    root = createRoot(document.body.appendChild(document.createElement('main')))
    expect(onPostTargetUsed).not.toHaveBeenCalled()
  })
})
