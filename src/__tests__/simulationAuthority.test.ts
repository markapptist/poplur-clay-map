// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../nativeBridge', () => ({ isNativeShell: () => true }))
vi.mock('../nativeAuth', () => ({ authToken: () => 'fixture-token', requestAuthToken: vi.fn() }))
import { loadTestSimulation, loadTestSimulationFeed } from '../testActivity'
import { isLiveSimulationEnabled, setLiveSimulationEnabled } from '../simulationControl'
import { feedPostReachesViewer } from '../feedDiscovery'

afterEach(() => { vi.unstubAllGlobals(); setLiveSimulationEnabled(false) })

describe('tester mode authority', () => {
  it('keeps server-enabled tester posts visible when the private event endpoint is disabled', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      const action = JSON.parse(options.body).data.action
      return { ok: true, json: async () => ({ result: action === 'simulation'
        ? { enabled: true }
        : { enabled: false, events: [], reason: 'runner-events-are-private' } }) }
    }))
    await loadTestSimulation()
    const distantTesterPost = { syntheticCohort: true, radiusMeters: 5000 }
    expect(feedPostReachesViewer(distantTesterPost, null)).toBe(true)
    for (let poll = 0; poll < 6; poll++) {
      expect((await loadTestSimulationFeed()).events).toEqual([])
      expect(isLiveSimulationEnabled()).toBe(true)
      expect(feedPostReachesViewer(distantTesterPost, null)).toBe(true)
    }
  })

  it('still applies an explicit disabled response from the configuration endpoint', async () => {
    setLiveSimulationEnabled(true)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ result: { enabled: false } }) })))
    expect(await loadTestSimulation()).toBe(false)
    expect(isLiveSimulationEnabled()).toBe(false)
  })
})
