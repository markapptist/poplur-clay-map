import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildMapPointCycle, stepMapPointCycle, pinOwnerKey } from '../mapPointCycle'
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
    // Landing on a pop opens its card (5 Sep 2026): the arrival callback is
    // the tap's preview window, guarded against a point already stepped past.
    expect(cycle).toContain("flyToCenter(point.coords, TOUR_FLIGHT_MS, frame, 'map-point-cycle', pin ? () => {")
    expect(cycle).toContain('if (focusedMapPointKeyRef.current !== point.key) return')
    expect(cycle).toContain('showPinContentCard(pin)')
    expect(cycle).toContain('} : undefined, point.kind)')
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

describe('traverse a poster’s pops from their map handle', () => {
  it('groups by account and displayed handle, with identity fallbacks', () => {
    expect(pinOwnerKey({ ownerId: 'uid-9', user: '@runwayraw' })).toBe(JSON.stringify(['uid-9', 'runwayraw']))
    expect(pinOwnerKey({ user: '@runwayraw' })).toBe('@runwayraw')
    expect(pinOwnerKey({ ownerId: null, user: null })).toBe('self')
  })

  it('a route filtered to one poster walks only that poster’s pins', () => {
    // The shell builds this filtered cycle when a handle is armed: only the
    // owner’s pins, and no current-location or landmark stops in the loop.
    const all = [
      { id: 'a1', name: 'A one', coords: [-79.4, 43.66] as [number, number], mine: false, radiusKm: 2, ownerId: 'uid-a', user: '@ay' },
      { id: 'b1', name: 'B one', coords: [-79.37, 43.65] as [number, number], mine: false, radiusKm: 9, ownerId: 'uid-b', user: '@bee' },
      { id: 'a2', name: 'A two', coords: [-79.36, 43.64] as [number, number], mine: false, radiusKm: 5, ownerId: 'uid-a', user: '@ay' },
    ]
    const armed = pinOwnerKey(all[0])
    const route = buildMapPointCycle({
      currentLocation: null,
      pins: all.filter(pin => pinOwnerKey(pin) === armed),
      landmarks: [],
    })
    expect(route.map(point => point.key)).toEqual(['pin:a1', 'pin:a2'])
    // The arrows loop within the two, never escaping to the other poster.
    const first = stepMapPointCycle(route, null, 1)
    expect(first).toMatchObject({ index: 0, total: 2 })
    const wrapped = stepMapPointCycle(route, 'pin:a2', 1)
    expect(wrapped).toMatchObject({ point: { key: 'pin:a1' }, index: 0, total: 2 })
  })

  it('separates posters sharing a publishing account and wraps only their posts', () => {
    const pins = ['@hauls', '@pitchside', '@hauls', '@sauceboss'].map((user, i) => ({
      id: String(i), user, ownerId: 'shared-publisher', name: user,
      coords: [0, 0] as [number, number], mine: false, radiusKm: 1,
    }))
    const selected = pinOwnerKey(pins[0])
    const matching = pins.filter(pin => pinOwnerKey(pin) === selected)
    expect(matching.map(pin => pin.id)).toEqual(['0', '2'])
    const route = buildMapPointCycle({ currentLocation: null, pins: matching, landmarks: [] })
    for (const direction of [-1, 1] as const) {
      let key = 'pin:0'
      for (let i = 0; i < 6; i++) {
        const step = stepMapPointCycle(route, key, direction)!
        expect(step.total).toBe(2)
        expect(step.point.name).toBe('@hauls')
        key = step.point.key
      }
    }
    expect(pinOwnerKey({ ownerId: 'another-account', user: '@hauls' })).not.toBe(selected)
    expect(pinOwnerKey({ ownerId: 'shared-publisher', user: ' HAULS ' })).toBe(selected)
  })

  it('uses the same identity for marker highlights and the arrow route', () => {
    expect(clayMapSource).toContain('markerRoot.dataset.dominationOwner = pinOwnerKey(pin)')
    expect(clayMapSource).toContain('dominationTerritoryLabelActive')
    expect(mapAppSource).toContain('pinOwnerKey(pin) === focusedUserKey')
    expect(mapAppSource).toContain('focusedLabelUserKey={tourOn ? null : focusedUserKey}')
  })
})
