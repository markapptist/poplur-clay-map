// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Map as MapboxMap } from 'mapbox-gl'

const transport = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('../mapDiscoveryTransport', () => ({
  queryMapDiscovery: (...args: unknown[]) => transport.query(...args),
}))

import { mapBoardPosts, normalizeDiscoveryPage, type DiscoveryPage } from '../mapDiscovery'
import { MAP_DISCOVERY_REFRESH_MS, discoveryRefreshDelayMs, useMapDiscovery } from '../useMapDiscovery'

const row = { userID: 'owner', username: 'owner', caption: 'Hi', radiusMeters: 5000, latitude: 43.65, longitude: -79.38, locationVisibility: 'approximate' }
const response = (...ids: string[]) => ({ schema: 1, enabled: true, mode: 'regions', posts: ids.map(id => ({ id, row })) })
const refused = () => Promise.reject(Object.assign(new Error('FirebaseError: no available instance'), { name: 'FirebaseError' }))
// The shell's forwarded pool, as MapApp holds it.
const forwarded = normalizeDiscoveryPage(response('pool-1', 'pool-2'), 'viewer').pins

// The phone's opening view: zoom 1, the Americas.
const map = {
  isMoving: () => false,
  getZoom: () => 1,
  getBounds: () => ({ getWest: () => -148, getEast: () => -11, getSouth: () => -75, getNorth: () => 85 }),
  on: vi.fn(), off: vi.fn(),
} as unknown as MapboxMap
const mapRef = { current: map }
const front = { current: true }
let latest: ReturnType<typeof useMapDiscovery>
function Probe() {
  latest = useMapDiscovery(mapRef, 1, 'viewer', true, front)
  return null
}
let root: ReturnType<typeof createRoot>
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const board = (page: DiscoveryPage | null) => mapBoardPosts(page, forwarded)

beforeEach(() => {
  vi.useFakeTimers()
  transport.query.mockReset()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  root = createRoot(document.createElement('div'))
})
afterEach(() => { act(() => root.unmount()); vi.useRealTimers() })

describe('map discovery never blanks the board', () => {
  it('backs off 3 s, 10 s, 30 s, then the minute', () => {
    expect([0, 1, 2, 3, 4, 9].map(discoveryRefreshDelayMs)).toEqual([MAP_DISCOVERY_REFRESH_MS, 3_000, 10_000, 30_000, MAP_DISCOVERY_REFRESH_MS, MAP_DISCOVERY_REFRESH_MS])
  })

  it('a refused first load leaves the forwarded pool on the board and retries quickly', async () => {
    transport.query.mockImplementation(refused)
    act(() => root.render(<Probe />))
    await advance(220)
    expect(transport.query).toHaveBeenCalledTimes(1)
    expect(latest.page).toBeNull()
    expect(latest.error).not.toBeNull()
    expect(board(latest.page)).toBe(forwarded)
    await advance(2_999); expect(transport.query).toHaveBeenCalledTimes(1)
    await advance(1); expect(transport.query).toHaveBeenCalledTimes(2)
    await advance(10_000); expect(transport.query).toHaveBeenCalledTimes(3)
    await advance(30_000); expect(transport.query).toHaveBeenCalledTimes(4)
    await advance(30_000); expect(transport.query).toHaveBeenCalledTimes(4)
    await advance(30_000); expect(transport.query).toHaveBeenCalledTimes(5)
    // The error does not blink off while a retry is in flight: the Map's
    // browser fallback keys off it.
    transport.query.mockImplementationOnce(() => new Promise(() => {}))
    await advance(MAP_DISCOVERY_REFRESH_MS)
    expect(transport.query).toHaveBeenCalledTimes(6)
    expect(latest.error).not.toBeNull()
    expect(board(latest.page)).toBe(forwarded)
  })

  it('a refused refresh keeps the last page that loaded', async () => {
    transport.query.mockResolvedValueOnce(response('d1', 'd2', 'd3'))
    act(() => root.render(<Probe />))
    await advance(220)
    const served = latest.page
    expect(served?.pins.map(pin => pin.id)).toHaveLength(3)
    expect(latest.error).toBeNull()
    expect(board(latest.page)).toBe(served!.pins)

    transport.query.mockImplementation(refused)
    await advance(MAP_DISCOVERY_REFRESH_MS)
    expect(transport.query).toHaveBeenCalledTimes(2)
    expect(latest.error).not.toBeNull()
    expect(latest.page).toBe(served)
    expect(board(latest.page)).toHaveLength(3)

    // The next good answer replaces the page wholesale and clears the error.
    transport.query.mockReset()
    transport.query.mockResolvedValueOnce(response('d4'))
    await advance(3_000)
    expect(latest.error).toBeNull()
    expect(board(latest.page)?.map(pin => pin.id)).toHaveLength(1)
  })

  it('healthy discovery draws its own pins, not the pool', async () => {
    transport.query.mockResolvedValue(response('d1', 'd2'))
    act(() => root.render(<Probe />))
    await advance(220)
    expect(latest.page?.enabled).toBe(true)
    expect(board(latest.page)).toBe(latest.page!.pins)
    expect(board(latest.page)).not.toBe(forwarded)
    // A healthy page refreshes on the minute, not the retry ladder.
    await advance(3_000); expect(transport.query).toHaveBeenCalledTimes(1)
    await advance(MAP_DISCOVERY_REFRESH_MS - 3_000); expect(transport.query).toHaveBeenCalledTimes(2)
  })
})
