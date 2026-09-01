import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildMapPointCycle, stepMapPointCycle } from '../mapPointCycle'
import { WORLD_LANDMARK_PRESENTATIONS } from '../mapLandmarkCatalog'

const mapAppSource = readFileSync(resolve(process.cwd(), 'src', 'MapApp.tsx'), 'utf8')
const clayMapSource = readFileSync(resolve(process.cwd(), 'src', 'ClayMap.tsx'), 'utf8')
const homeTwinSource = readFileSync(resolve(process.cwd(), 'src', 'HomeTwin.tsx'), 'utf8')

const landmarks = [
  { id: 'eiffel', name: 'Eiffel Tower', coords: [2.2945, 48.8584] as [number, number] },
  { id: 'rogers-centre', name: 'Rogers Centre', coords: [-79.3892, 43.6416] as [number, number] },
]

describe('unified Map point cycle', () => {
  it('builds a zoom-independent route with location, every supplied pin, and landmarks', () => {
    const route = buildMapPointCycle({
      currentLocation: [-79.38, 43.65],
      pins: [
        { id: 'mine', name: 'Home', coords: [-79.4, 43.66], mine: true, radiusKm: 4.2 },
        { id: 'theirs', name: 'Market', coords: [-79.37, 43.65], mine: false, radiusKm: 9.8 },
      ],
      landmarks,
    })
    expect(route.map(point => point.key)).toEqual([
      'current:location',
      'pin:mine',
      'pin:theirs',
      'landmark:eiffel',
      'landmark:rogers-centre',
    ])
  })

  it('reveals every pin radius, zero included — the number is public post data', () => {
    const route = buildMapPointCycle({
      currentLocation: [0, 0],
      pins: [
        { id: 'mine', name: 'Mine', coords: [1, 1], mine: true, radiusKm: 7.5 },
        { id: 'other', name: 'Other', coords: [2, 2], mine: false, radiusKm: 88 },
        { id: 'fresh', name: 'Fresh', coords: [3, 3], mine: false, radiusKm: 0 },
      ],
      landmarks,
    })
    expect(route.find(point => point.key === 'pin:mine')?.radiusKm).toBe(7.5)
    expect(route.find(point => point.key === 'pin:other')?.radiusKm).toBe(88)
    expect(route.find(point => point.key === 'pin:fresh')?.radiusKm).toBe(0)
    expect(route.find(point => point.kind === 'current')?.radiusKm).toBeNull()
    expect(route.find(point => point.kind === 'landmark')?.radiusKm).toBeNull()
  })

  it('walks every point exactly once and wraps in both directions', () => {
    const route = buildMapPointCycle({ currentLocation: [0, 0], pins: [], landmarks })
    const right: string[] = []
    let key: string | null = null
    for (let i = 0; i < route.length + 1; i += 1) {
      const step = stepMapPointCycle(route, key, 1)
      expect(step).not.toBeNull()
      key = step!.point.key
      right.push(key)
    }
    expect(right.slice(0, route.length)).toEqual(route.map(point => point.key))
    expect(right[right.length - 1]).toBe(route[0].key)

    const left = stepMapPointCycle(route, null, -1)
    expect(left?.point.key).toBe(route[route.length - 1]?.key)
    expect(stepMapPointCycle(route, route[0].key, -1)?.point.key).toBe(route[route.length - 1]?.key)
  })

  it('recovers from a removed selection and preserves namespaced id collisions', () => {
    const route = buildMapPointCycle({
      currentLocation: null,
      pins: [{ id: 'eiffel', name: 'Post', coords: [1, 1], mine: true, radiusKm: 1 }],
      landmarks,
    })
    expect(route.map(point => point.key)).toContain('pin:eiffel')
    expect(route.map(point => point.key)).toContain('landmark:eiffel')
    expect(stepMapPointCycle(route, 'pin:deleted', 1)?.index).toBe(0)
    expect(stepMapPointCycle(route, 'pin:deleted', -1)?.index).toBe(route.length - 1)
  })

  it('rejects invalid coordinates but keeps the valid null-island coordinate', () => {
    const route = buildMapPointCycle({
      currentLocation: [0, 0],
      pins: [
        { id: 'bad-lng', name: 'Bad', coords: [181, 2], mine: true, radiusKm: 1 },
        { id: 'bad-lat', name: 'Bad', coords: [2, -91], mine: true, radiusKm: 1 },
      ],
      landmarks: [{ id: 'bad', name: 'Bad', coords: [Number.NaN, 0] }],
    })
    expect(route).toHaveLength(1)
    expect(route[0].coords).toEqual([0, 0])
    expect(stepMapPointCycle([], null, 1)).toBeNull()
  })

  it('includes all thirteen grounded landmark subjects, including the shared Rogers renderer', () => {
    expect(WORLD_LANDMARK_PRESENTATIONS).toHaveLength(13)
    expect(WORLD_LANDMARK_PRESENTATIONS.some(landmark => landmark.id === 'rogers-centre')).toBe(true)
    expect(mapAppSource).toMatch(/MAP_POINT_LANDMARKS = TOUR_DESTINATIONS[\s\S]*?landmarkCameraFrame\(destination\.id\)/)
  })

  it('routes both horizontal controls and map edge lanes through one point action', () => {
    expect(mapAppSource).toContain("action: 'cycleMapPoint'")
    expect(mapAppSource).toContain("upLabel={tourMode === 'news' ? 'Previous news story' : 'Previous map point'}")
    expect(mapAppSource).toContain("downLabel={tourMode === 'news' ? 'Next news story' : 'Next map point'}")
    expect(clayMapSource).toContain("action: 'cycleMapPoint', dir")
  })

  it('uses the cancellable point-cycle camera mode instead of replaying a landmark tour', () => {
    const cycle = mapAppSource.slice(
      mapAppSource.indexOf('const cycleMapPoint = useCallback'),
      mapAppSource.indexOf('// A delete or privacy change removes a post'),
    )
    expect(cycle).toContain("flyToCenter(point.coords, TOUR_FLIGHT_MS, frame, 'map-point-cycle', undefined, point.kind)")
    expect(cycle).toContain('mapPointRadiusFrameZoom(point.radiusKm, point.coords[1], radiusViewport)')
    expect(cycle).toContain('landmarkTourCameraFrame(point.id)')
    expect(cycle).not.toContain("'landmark-tour'")
  })

  it('keeps one universal highlight and explicitly clears non-owned radius paint', () => {
    expect(clayMapSource).toContain('root.dataset.mapPointHighlight = focusedMapPoint.key')
    expect(mapAppSource).toContain("point.kind === 'pin' && point.mine && point.radiusKm != null")
    expect(mapAppSource).toMatch(/ownRadius \? new mapboxgl\.LngLat[\s\S]*?: null/)
    expect(mapAppSource).toContain("data-map-point-radius-visible={focusedMapPoint.radiusKm != null ? 'true' : 'false'}")
  })

  it('uses the molded point card as the only location label while preserving radio status', () => {
    expect(mapAppSource).toContain('const mapPointLabelActive = Boolean(focusedMapPoint && !tourOn)')
    expect(mapAppSource).toContain("type: 'poplur-map-point-focus'")
    expect(mapAppSource).toContain('active: mapPointLabelActive')
    expect(mapAppSource).toMatch(/!mapPointLabelActive && \([\s\S]*?className=\{styles\.aiTicker\}/)
    expect(mapAppSource).toContain('!mapPointLabelActive && !tourOn && areaPops')
    expect(mapAppSource).toContain('<MapRadioStatusLabel className={styles.mapRadioLabel} />')

    expect(homeTwinSource).toContain("event.data.type === 'poplur-map-point-focus'")
    expect(homeTwinSource).toContain('setMapPointLabelActive(event.data.active === true)')
    expect(homeTwinSource).toMatch(/!mapPointLabelActive && \(\s*<span key=\{mapPlace\} className=\{styles\.mapTitleText\}>/)
    // The area count now lives INSIDE the place card rather than beside it, so
    // prove containment instead of matching the old flat guard: everything the
    // card carries is hidden by the one !mapPointLabelActive gate above.
    const homeCard = homeTwinSource.slice(
      homeTwinSource.indexOf('<span key={mapPlace} className={styles.mapTitleText}>'),
      homeTwinSource.indexOf('</span>', homeTwinSource.indexOf('<span key={mapPlace}')),
    )
    expect(homeCard).toContain('!mapTourOn && mapAreaPops')
    expect(homeCard).toContain('className={styles.mapAreaPops}')
    expect(homeTwinSource).toContain('<MapRadioStatusLabel className={styles.mapRadioLabel} />')
  })

  it('clears embedded point-label ownership when the map reloads, fails, or unmounts', () => {
    expect(mapAppSource).toMatch(/useEffect\(\(\) => \(\) => \{[\s\S]*?type: 'poplur-map-point-focus',[\s\S]*?active: false/)
    const loading = homeTwinSource.slice(
      homeTwinSource.indexOf("event.data.type === 'poplur-map-loading'"),
      homeTwinSource.indexOf("event.data.type === 'poplur-account-radius'"),
    )
    const failed = homeTwinSource.slice(
      homeTwinSource.indexOf("event.data.type === 'poplur-map-failed'"),
      homeTwinSource.indexOf("event.data.type === 'poplur-map-night'"),
    )
    expect(loading).toContain('setMapPointLabelActive(false)')
    expect(failed).toContain('setMapPointLabelActive(false)')
  })
})
