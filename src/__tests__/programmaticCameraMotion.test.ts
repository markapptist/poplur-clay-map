import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CLOSE_PROGRAMMATIC_CAMERA_MIN_ZOOM,
  programmaticCameraBlurAllowed,
  programmaticCameraPoseMatches,
  programmaticCameraPlan,
  programmaticCameraPlanForMode,
} from '../programmaticCameraMotion'

const mapAppSource = readFileSync(resolve(process.cwd(), 'src', 'MapApp.tsx'), 'utf8')
const clayMapSource = readFileSync(resolve(process.cwd(), 'src', 'ClayMap.tsx'), 'utf8')

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

  it('restages every landmark-tour flight and preserves each authored target zoom', () => {
    const authoredZooms = [15.3, 15.6, 17.08, 15.44, 17.6]
    let currentZoom = authoredZooms[0]

    for (const targetZoom of authoredZooms.slice(1)) {
      expect(programmaticCameraPlanForMode(
        currentZoom,
        targetZoom,
        'landmark-tour',
      )).toEqual({ kind: 'staged', zoom: targetZoom })
      currentZoom = targetZoom
    }
  })

  it('keeps non-landmark authored moves on the existing adaptive path', () => {
    expect(programmaticCameraPlanForMode(15.4, 17.6, 'authored')).toEqual({
      kind: 'translate',
      zoom: 15.4,
    })
  })

  it('does not advance a tour stage for an unrelated moveend pose', () => {
    expect(programmaticCameraPoseMatches(
      { zoom: 15.3, pitch: 32, bearing: 0 },
      { pitch: 0, bearing: 0 },
    )).toBe(false)
    expect(programmaticCameraPoseMatches(
      { zoom: 13.9, pitch: 0, bearing: 0 },
      { zoom: 13.9, pitch: 0, bearing: 0 },
    )).toBe(true)
  })

  it('compares authored bearings across the wrap boundary', () => {
    expect(programmaticCameraPoseMatches(
      { zoom: 17, pitch: 42, bearing: -179 },
      { zoom: 17, pitch: 42, bearing: 179 },
    )).toBe(true)
  })

  it('retires the adaptive settle before stopping the previous tour flight', () => {
    expect(clayMapSource).toContain(
      'mapCamera.__cancelAdaptiveCameraSettle = cancelAdaptiveCameraSettle',
    )
    const flight = mapAppSource.slice(
      mapAppSource.indexOf('const flyToCenter = useCallback'),
      mapAppSource.indexOf('const flyToPop = useCallback'),
    )
    const claimsCamera = flight.indexOf('mapCamera.__cinematic = true')
    const cancelsAdaptive = flight.indexOf('mapCamera.__cancelAdaptiveCameraSettle?.()')
    const stopsPrevious = flight.indexOf('map.stop()')
    expect(claimsCamera).toBeGreaterThanOrEqual(0)
    expect(cancelsAdaptive).toBeGreaterThan(claimsCamera)
    expect(stopsPrevious).toBeGreaterThan(cancelsAdaptive)
  })

  it('recovers a lost arrival with its authored offset and bounds Mapbox-readiness retries', () => {
    const activation = mapAppSource.slice(
      mapAppSource.indexOf('const activateTourDestination = useCallback'),
      mapAppSource.indexOf('const startExplicitTourLoop = useCallback'),
    )
    expect(activation).toContain('if (!mapRef.current) return false')
    expect(activation).toContain('map.easeTo({')
    expect(activation).toContain('duration: 0')
    expect(activation).toContain('offset: tourFrame.offset')
    expect(mapAppSource).toContain('mapReadyAttempts >= TOUR_MAP_READY_MAX_ATTEMPTS')
    expect(mapAppSource).toContain('TOUR_MAP_READY_RETRY_MS')
    expect(mapAppSource).toContain('tourFlightInProgressRef.current = true')
  })

  it('keeps cinematic ownership through the synchronous moveend emitted by Pause', () => {
    const pause = mapAppSource.slice(
      mapAppSource.indexOf('landmarkTourPauseNowRef.current = () => {'),
      mapAppSource.indexOf('tourFlightInProgressRef.current = true', mapAppSource.indexOf('landmarkTourPauseNowRef.current = () => {')),
    )
    const claimsCamera = pause.indexOf('map.__cinematic = true')
    const preservesOwnership = pause.indexOf('cancelStagedCameraFlight(true)')
    const stopsFlight = pause.indexOf('map.stop()')
    const releasesCamera = pause.lastIndexOf('map.__cinematic = false')
    expect(claimsCamera).toBeGreaterThanOrEqual(0)
    expect(preservesOwnership).toBeGreaterThan(claimsCamera)
    expect(stopsFlight).toBeGreaterThan(preservesOwnership)
    expect(releasesCamera).toBeGreaterThan(stopsFlight)
  })

  it('never enables decorative blur for reduced-motion users', () => {
    expect(programmaticCameraBlurAllowed(false)).toBe(true)
    expect(programmaticCameraBlurAllowed(true)).toBe(false)
  })
})
