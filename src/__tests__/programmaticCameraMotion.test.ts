import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CLOSE_PROGRAMMATIC_CAMERA_MIN_ZOOM,
  MAP_POINT_MAX_TARGET_ZOOM,
  MAP_POINT_RADIUS_MAX_ZOOM,
  mapPointCycleCameraPlan,
  mapPointCycleDestinationPose,
  mapPointRadiusFrameZoom,
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

  it('keeps nearby point cycling at scale but directly frames distant and authored subjects', () => {
    expect(mapPointCycleCameraPlan({
      currentZoom: 17.2,
      targetZoom: 17.6,
      distanceMeters: 800,
      requiresTargetFraming: false,
    })).toEqual({
      kind: 'translate',
      zoom: 17.2,
    })
    expect(mapPointCycleCameraPlan({
      currentZoom: 17.2,
      targetZoom: 14.65,
      distanceMeters: 800,
      requiresTargetFraming: true,
    })).toEqual({ kind: 'translate', zoom: 14.65 })
    expect(mapPointCycleCameraPlan({
      currentZoom: 19.2,
      targetZoom: 17.6,
      distanceMeters: 2_000_000,
      requiresTargetFraming: false,
    })).toEqual({ kind: 'translate', zoom: 17.6 })
    expect(programmaticCameraPlanForMode(
      CLOSE_PROGRAMMATIC_CAMERA_MIN_ZOOM - 0.1,
      15.45,
      'map-point-cycle',
    )).toEqual({ kind: 'translate', zoom: 15.45 })
  })

  it('holds a birds-eye survey at its overview zoom while cycling points', () => {
    // Plain point, far away: normally a dive to the framed target.
    expect(mapPointCycleCameraPlan({
      currentZoom: 3,
      targetZoom: 17.6,
      distanceMeters: 2_000_000,
      requiresTargetFraming: false,
      holdWideOverview: true,
    })).toEqual({ kind: 'translate', zoom: 3 })
    // Authored landmark/radius frames must not override the held overview.
    expect(mapPointCycleCameraPlan({
      currentZoom: 1,
      targetZoom: 15.45,
      distanceMeters: 5_000_000,
      requiresTargetFraming: true,
      holdWideOverview: true,
    })).toEqual({ kind: 'translate', zoom: 1 })
    // Without the hold the same wide camera still dives as before.
    expect(mapPointCycleCameraPlan({
      currentZoom: 3,
      targetZoom: 17.6,
      distanceMeters: 2_000_000,
      requiresTargetFraming: false,
    })).toEqual({ kind: 'translate', zoom: 17.6 })
  })

  it('wires the birds-eye hold to the map min-zoom end stop', () => {
    const flight = mapAppSource.slice(
      mapAppSource.indexOf('const flyToCenter = useCallback'),
      mapAppSource.indexOf('const flyToPop = useCallback'),
    )
    expect(flight).toContain('const atWorldOverview = worldCountryZoomActive(currentZoom, MAP_MIN_ZOOM)')
    expect(flight).toContain('holdWideOverview: atWorldOverview')
    expect(flight).toContain("...(landmarkFrame?.offset && !atWorldOverview ? { offset: landmarkFrame.offset } : {})")
  })

  it('gives larger takeover radii a wider bounded destination frame', () => {
    const small = mapPointRadiusFrameZoom(0.5, 43.65, 390)
    const large = mapPointRadiusFrameZoom(20, 43.65, 390)
    expect(small).toBeLessThanOrEqual(MAP_POINT_RADIUS_MAX_ZOOM)
    expect(large).toBeLessThan(small)
    expect(mapPointRadiusFrameZoom(0.01, 0, 10_000)).toBe(MAP_POINT_RADIUS_MAX_ZOOM)
    expect(mapPointCycleCameraPlan({
      currentZoom: 21,
      targetZoom: 100,
      distanceMeters: Number.POSITIVE_INFINITY,
      requiresTargetFraming: true,
    }).zoom).toBe(MAP_POINT_MAX_TARGET_ZOOM)
  })

  it('restores a pitched close frame after point traversal from a flat overview', () => {
    expect(mapPointCycleDestinationPose({
      finalZoom: 17.6,
      currentZoom: 3,
      currentPitch: 0,
      currentBearing: 0,
      targetPitch: 28,
      targetBearing: 0,
      subject: 'pin',
      streetView: false,
    })).toEqual({ pitch: 28, bearing: 0, maxPitch: 36 })

    expect(mapPointCycleDestinationPose({
      finalZoom: 14.65,
      currentZoom: 3,
      currentPitch: 0,
      currentBearing: 0,
      targetPitch: 42,
      targetBearing: 22,
      subject: 'landmark',
      streetView: false,
    })).toEqual({ pitch: 42, bearing: 22, maxPitch: 42 })
  })

  it('retains an existing local isometric pose but keeps wide destination frames flat', () => {
    expect(mapPointCycleDestinationPose({
      finalZoom: 17.2,
      currentZoom: 17.4,
      currentPitch: 34,
      currentBearing: 51,
      targetPitch: 28,
      targetBearing: 0,
      subject: 'current',
      streetView: false,
    })).toEqual({ pitch: 34, bearing: 51, maxPitch: 36 })

    expect(mapPointCycleDestinationPose({
      finalZoom: 11.8,
      currentZoom: 17.4,
      currentPitch: 34,
      currentBearing: 51,
      targetPitch: 28,
      targetBearing: 0,
      subject: 'pin',
      streetView: false,
    })).toEqual({ pitch: 0, bearing: 0, maxPitch: 0 })
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

  it('moves a close point-cycle selection once into its resolved subject pose', () => {
    const flight = mapAppSource.slice(
      mapAppSource.indexOf('const flyToCenter = useCallback'),
      mapAppSource.indexOf('const flyToPop = useCallback'),
    )
    const directPointMove = flight.slice(
      flight.indexOf("motionMode === 'map-point-cycle'"),
      flight.indexOf('// The authored tour crosses flat'),
    )
    expect(flight.indexOf('cancelStagedCameraFlight()')).toBeLessThan(
      flight.indexOf("motionMode === 'map-point-cycle'"),
    )
    expect(flight.indexOf('map.stop()')).toBeLessThan(
      flight.indexOf("motionMode === 'map-point-cycle'"),
    )
    expect(directPointMove).toContain("cameraPlan.kind === 'translate'")
    expect(directPointMove).toContain('if (ownsFlight())')
    expect(directPointMove.match(/map\.easeTo\(\{/g)).toHaveLength(1)
    expect(directPointMove).toContain('zoom: cameraPlan.zoom')
    expect(directPointMove).toContain('pitch: destinationPose.pitch')
    expect(directPointMove).toContain('bearing: destinationPose.bearing')
    expect(directPointMove).toContain('map.setMaxPitch(Math.max(destinationPose.maxPitch')
    // The arrows FLIP to the next point: one zero-duration ease, arrival
    // handed back synchronously. A paced pan was tried and rejected
    // (5 Sep 2026) — stepping pin to pin, a cut reads as "next".
    expect(directPointMove).toContain('duration: 0')
    expect(directPointMove).not.toContain('mapPointCyclePanMs')
    expect(directPointMove).not.toContain("map.once('moveend'")
    expect(directPointMove).not.toContain('beginProgrammaticCameraMotion')
    expect(directPointMove).not.toContain('map.flyTo({')
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
