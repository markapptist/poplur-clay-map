import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createMapBuildingCullScheduler } from '../mapBuildingCullScheduler'

describe('settled Map building cull scheduler', () => {
  it('coalesces one camera gesture and tile activity into one settled pass', () => {
    const run = vi.fn()
    const scheduler = createMapBuildingCullScheduler(run)

    scheduler.markCameraGesture()
    scheduler.markSourceTilesChanged()
    scheduler.markSourceTilesChanged()
    scheduler.onIdle(true)

    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenLastCalledWith(true)
  })

  it('does not turn the filter-induced idle edge into an update loop', () => {
    const run = vi.fn()
    const scheduler = createMapBuildingCullScheduler(run)

    scheduler.onIdle(true)
    scheduler.onIdle(true)
    scheduler.onIdle(true)
    expect(run).toHaveBeenCalledTimes(1)

    scheduler.markCameraGesture()
    scheduler.onIdle(true)
    scheduler.onIdle(true)
    expect(run).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenLastCalledWith(false)
  })

  it('ignores source reloads caused by its own applied filter until a new gesture', () => {
    let scheduler: ReturnType<typeof createMapBuildingCullScheduler>
    const run = vi.fn(() => scheduler.markSourceTilesChanged())
    scheduler = createMapBuildingCullScheduler(run)

    scheduler.onIdle(true)
    // Mapbox may deliver the source-cache reload synchronously from setFilter,
    // or queue it immediately after the settled pass. Neither may re-query.
    scheduler.markSourceTilesChanged()
    scheduler.onIdle(true)
    expect(run).toHaveBeenCalledTimes(1)

    scheduler.markCameraGesture()
    scheduler.markSourceTilesChanged()
    scheduler.onIdle(true)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('holds pending work while 3D is parked and runs it once on re-entry', () => {
    const run = vi.fn()
    const scheduler = createMapBuildingCullScheduler(run)

    scheduler.markPolicyChanged()
    scheduler.onIdle(false)
    expect(run).not.toHaveBeenCalled()

    scheduler.onIdle(true)
    scheduler.onIdle(true)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('coalesces a user gesture with the internal close-pitch camera settle', () => {
    const run = vi.fn()
    const scheduler = createMapBuildingCullScheduler(run)

    scheduler.markCameraGesture()
    // The first idle can precede the next-rAF jumpTo. Runtime reports the 3D
    // camera as unsettled here, so selection remains pending.
    scheduler.onIdle(false)
    scheduler.markCameraGesture() // Mapbox movestart emitted by internal jumpTo
    scheduler.onIdle(true)
    scheduler.onIdle(true)
    expect(run).toHaveBeenCalledTimes(1)

    const source = readFileSync(new URL('../ClayMap.tsx', import.meta.url), 'utf8')
    expect(source).toMatch(/buildingCullScheduler\.onIdle\(\s*adaptiveThreeDimensional\s*&&\s*adaptiveCameraFrame\s*==\s*null,?\s*\)/)
  })
})
