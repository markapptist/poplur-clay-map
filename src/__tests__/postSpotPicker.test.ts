import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const clayMapSource = readFileSync(resolve(process.cwd(), 'src', 'ClayMap.tsx'), 'utf8')
const clayMapCss = readFileSync(resolve(process.cwd(), 'src', 'ClayMap.module.css'), 'utf8')
const mapAppSource = readFileSync(resolve(process.cwd(), 'src', 'MapApp.tsx'), 'utf8')
const homeTwinSource = readFileSync(resolve(process.cwd(), 'src', 'HomeTwin.tsx'), 'utf8')
const composerSource = readFileSync(resolve(process.cwd(), 'src', 'PostComposer.tsx'), 'utf8')

describe('the post picker can be moved', () => {
  // The regression this whole file exists for: the composer's dismiss scrim is
  // an inset:0 <button>, and in the picker the composer never closes, so the
  // button sat over the entire canvas and ate every drag, pinch and
  // double-tap. Nothing reported as disabled — dragPan and scrollZoom were
  // both enabled the whole time — the gestures simply never reached Mapbox.
  it('never puts an interactive layer over the whole picker canvas', () => {
    expect(clayMapSource).toContain("{composeAt && focusedPickerLaunch && (")
    expect(clayMapSource).toContain('className={`${styles.composeDismissLayer} ${styles.composePickerVeil}`}')
    // The clickable scrim is still right everywhere else, and must stay
    // excluded from the picker.
    expect(clayMapSource).toContain('{composeAt && !radiusPreviewLaunch && !focusedPickerLaunch && (')
  })

  it('keeps the picker veil out of the pointer path', () => {
    const veil = clayMapCss.slice(clayMapCss.indexOf('.composePickerVeil'))
    expect(veil.slice(0, veil.indexOf('}'))).toContain('pointer-events: none')
  })

  it('lands wide enough that the first pinch is worth making', () => {
    expect(clayMapSource).toContain('const FOCUSED_PICK_LANDING_ZOOM = 15.4')
    expect(clayMapSource).toContain('const launchZoom = focusedPickerLaunch\n        ? FOCUSED_PICK_LANDING_ZOOM')
    // Radius review is the other focused launch and keeps its close framing.
    expect(clayMapSource).toContain('const focusedPickerLaunch = focusedPostLaunch && !radiusPreviewLaunch')
  })

  it('offers the map search and the way back from inside the picker card', () => {
    expect(clayMapSource).toContain('<strong>Search a place</strong>')
    expect(clayMapSource).toContain('<strong>My location</strong>')
    expect(clayMapSource).toContain('onClick={returnPickerToCurrentLocation}')
    expect(mapAppSource).toContain('onRequestSearch={openSearch}')
  })

  it('moves the pending post with the camera when the user travels', () => {
    // Otherwise "Use this spot" still points at the area they left, off-screen.
    expect(mapAppSource).toContain('.__poplurPickerAnchor?.(landmarkFrame?.center ?? center)')
    expect(clayMapSource).toContain('holder.__poplurPickerAnchor = center => { anchorPickerAt(center) }')
    // A point chosen by hand stays chosen: travel marks the selection manual
    // so a late location fix cannot pull the prompt back home.
    expect(clayMapSource).toContain('focusedPostManualSelectionRef.current = true\n    focusedPostResolvedLocationRef.current = true')
  })
})

describe('the claim preview never hands the camera an undefined angle', () => {
  // This one cost a whole afternoon. updateComposeRadiusPreview passed
  // `pitch: options?.pitch, bearing: options?.bearing` straight into
  // fitBounds. Only radius review supplies them, so in the post picker both
  // were `undefined` — and an explicit `bearing: undefined` is NOT the same as
  // omitting it. Mapbox assigns it through to `set bearing`, rotation becomes
  // NaN, _calcMatrices throws "failed to invert matrix" on every later frame,
  // the launch frame never paints, and twelve seconds later the picker
  // replaces itself with "The map renderer is unavailable on this browser".
  //
  // The composer path was shielded only by accident: an unearned account sized
  // a 0 km claim, which returns before the fitBounds. Flooring the picker at
  // the 5 km discovery seed removed the shield and broke the picker outright.
  it('omits pitch and bearing rather than passing undefined', () => {
    expect(clayMapSource).toContain("...(options?.pitch === undefined ? {} : { pitch: options.pitch })")
    expect(clayMapSource).toContain("...(options?.bearing === undefined ? {} : { bearing: options.bearing })")
    // The literal shape that caused it must not come back.
    expect(clayMapSource).not.toContain('pitch: options?.pitch,')
    expect(clayMapSource).not.toContain('bearing: options?.bearing,')
  })
})

describe('the picker knows what it is finding ground for', () => {
  it('carries the draft channel and the scene onto the picker URL', () => {
    expect(homeTwinSource).toContain('&pickChannel=')
    expect(homeTwinSource).toContain('&pickScene=')
    // PEEK: the composer still owns the draft and comes back for it.
    expect(homeTwinSource).toContain('const draft = peekPendingMapPost()')
    expect(homeTwinSource).not.toContain('takePendingMapPost()')
  })

  it('reuses the detector that already ran instead of scanning again', () => {
    expect(composerSource).toContain('sceneTerms: getLastSceneTerms()')
    const cameraSource = readFileSync(resolve(process.cwd(), 'src', 'Camera.tsx'), 'utf8')
    expect(cameraSource).toContain('setLastSceneTerms(currentCameraReads')
    // Who the poster is, is not what the scene is.
    expect(cameraSource).toContain('.filter(read => !read.user && !read.isUser)')
  })

  it('judges coverage against every own pop, not the capped marker board', () => {
    expect(mapAppSource).toContain('const ownLiveClaims = useMemo(() => accountPostedClaims(liveMapPosts)')
    expect(mapAppSource).toContain('ownClaims={ownLiveClaims}')
  })

  it('suggests, and never places', () => {
    // Taking a suggestion travels there. Committing the post stays a separate,
    // deliberate press on "Use this spot".
    expect(clayMapSource).toContain('const travelToSuggestion = useCallback((suggestion: SpotSuggestion)')
    expect(clayMapSource).toContain('onClick={() => travelToSuggestion(suggestion)}')
    expect(clayMapSource).not.toContain('poplur-post-here\', lat: suggestion')
  })

  it('spends a geocoder request only when the pick point has really moved', () => {
    expect(clayMapSource).toContain('const SPOT_REFRESH_DISTANCE_M = 2_500')
    expect(clayMapSource).toContain('if (previous && spotDistanceMeters(previous, origin) < SPOT_REFRESH_DISTANCE_M) return')
  })
})
