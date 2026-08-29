import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  createMapBuildingCullScheduler,
  createSettledMapLayerVisibilityRetry,
  reconcileMapLayerVisibility,
} from '../mapBuildingCullScheduler'

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

  it('retries a cold-source defer and settles without another user gesture', () => {
    let sourceReady = false
    const run = vi.fn(() => sourceReady)
    const scheduler = createMapBuildingCullScheduler(run)

    scheduler.onIdle(true)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenLastCalledWith(true)

    sourceReady = true
    scheduler.markSourceTilesChanged()
    scheduler.onIdle(true)
    scheduler.onIdle(true)
    expect(run).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenLastCalledWith(true)
  })

  it('accepts a loaded-source empty selection as settled', () => {
    const run = vi.fn(() => true)
    const scheduler = createMapBuildingCullScheduler(run)

    scheduler.onIdle(true)
    scheduler.onIdle(true)
    expect(run).toHaveBeenCalledTimes(1)
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

  it('applies a stationary performance-budget change once without a source-reload query loop', () => {
    let scheduler: ReturnType<typeof createMapBuildingCullScheduler>
    const run = vi.fn(() => {
      // Mapbox's setFilter can synchronously invalidate the source cache.
      scheduler.markSourceTilesChanged()
      return true
    })
    scheduler = createMapBuildingCullScheduler(run)

    scheduler.onIdle(true)
    expect(run).toHaveBeenCalledTimes(1)

    scheduler.markPolicyChanged()
    scheduler.onIdle(true)
    scheduler.markSourceTilesChanged()
    scheduler.onIdle(true)

    expect(run).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenLastCalledWith(false)
  })

  it('coalesces direct close-detail entry and its isometric ease into one settled query', () => {
    const run = vi.fn()
    const scheduler = createMapBuildingCullScheduler(run)

    scheduler.markCameraGesture()
    scheduler.markPolicyChanged()
    // The detail layer may already be requested/visible, but the runtime keeps
    // the scheduler's 3D gate false while its one adaptive rAF is pending.
    scheduler.onIdle(false)
    expect(run).not.toHaveBeenCalled()

    // easeTo emits movestart synchronously and cannot emit idle while moving.
    // Its completion therefore consumes the coalesced epoch exactly once.
    scheduler.markCameraGesture()
    scheduler.onIdle(true)
    scheduler.onIdle(true)
    expect(run).toHaveBeenCalledTimes(1)

    const source = readFileSync(new URL('../ClayMap.tsx', import.meta.url), 'utf8')
    expect(source).toMatch(/buildingCullScheduler\.onIdle\(\s*lastThreeDLayerVisibility\s*===\s*true\s*&&\s*adaptiveCameraFrame\s*==\s*null,?\s*\)/)
    expect(source).toMatch(/createMapBuildingCullScheduler\(refreshSelection\s*=>\s*\{\s*return updateBuildingExtrusionCull\(false, refreshSelection\)/)
  })
})

describe('Map building layer visibility reconciliation', () => {
  it('does not cache a rejected style-transition write and succeeds on retry', () => {
    let visibility: 'visible' | 'none' = 'none'
    let rejectWrite = true
    const map = {
      getLayer: vi.fn(() => ({})),
      getLayoutProperty: vi.fn(() => visibility),
      setLayoutProperty: vi.fn((_id: string, _name: 'visibility', value: 'visible' | 'none') => {
        if (rejectWrite) throw new Error('style transition')
        visibility = value
      }),
    }

    expect(reconcileMapLayerVisibility(map, ['clay-buildings-3d'], true)).toBe(false)
    expect(visibility).toBe('none')

    rejectWrite = false
    expect(reconcileMapLayerVisibility(map, ['clay-buildings-3d'], true)).toBe(true)
    expect(visibility).toBe('visible')
    expect(map.setLayoutProperty).toHaveBeenCalledTimes(2)
  })

  it('retries a rejected request on one settled edge and then becomes a no-op', () => {
    let rejectWrite = true
    const apply = vi.fn(() => !rejectWrite)
    const retry = createSettledMapLayerVisibilityRetry(apply)

    expect(retry.request(true)).toBe(false)
    expect(retry.hasPending()).toBe(true)

    rejectWrite = false
    expect(retry.retryOnSettled()).toBe(true)
    expect(retry.hasPending()).toBe(false)
    expect(retry.retryOnSettled()).toBe(true)
    expect(apply).toHaveBeenCalledTimes(2)

    const source = readFileSync(new URL('../ClayMap.tsx', import.meta.url), 'utf8')
    expect(source).toMatch(/threeDVisibilityRetry\.retryOnSettled\(\)[\s\S]*?buildingCullScheduler\.onIdle/)
  })
})
