import { describe, expect, it } from 'vitest'
import {
  claimReplaysBeforeQueuedActions,
  enqueueMapFallbackAction,
  nativeMapHandlesAction,
  type QueuedMapAction,
} from '../nativeMapFallback'

describe('native map fallback routing', () => {
  it('keeps only complete MapKit actions native', () => {
    expect(nativeMapHandlesAction('locate')).toBe(true)
    expect(nativeMapHandlesAction('setZoom')).toBe(true)
    expect(nativeMapHandlesAction('engagement')).toBe(true)

    for (const action of [
      'search', 'tour', 'setPopLevel', 'weather', 'directions',
      'cycleTourLandmark', 'newsTour', 'cycleNews', 'focusNews',
      'openComposer', 'dropClaim', 'futureAction',
    ]) {
      expect(nativeMapHandlesAction(action), action).toBe(false)
    }
  })

  it('preserves action order while coalescing queued zoom input', () => {
    let queued: QueuedMapAction[] = []
    queued = enqueueMapFallbackAction(queued, { action: 'search', detail: {} })
    queued = enqueueMapFallbackAction(queued, { action: 'setZoom', detail: { zoom: 0.2 } })
    queued = enqueueMapFallbackAction(queued, { action: 'tour', detail: {} })
    queued = enqueueMapFallbackAction(queued, { action: 'setZoom', detail: { zoom: 0.8 } })

    expect(queued).toEqual([
      { action: 'search', detail: {} },
      { action: 'tour', detail: {} },
      { action: 'setZoom', detail: { zoom: 0.8 } },
    ])
  })

  it('bounds a pre-ready burst', () => {
    const queued = Array.from({ length: 4 }, (_, index) => ({
      action: `action-${index}`,
      detail: {},
    }))
    expect(enqueueMapFallbackAction(queued, { action: 'latest', detail: {} }, 3))
      .toEqual([
        { action: 'action-2', detail: {} },
        { action: 'action-3', detail: {} },
        { action: 'latest', detail: {} },
      ])
  })

  it('does not replay a fresh queued claim before its arrival action', () => {
    const saved = [
      { action: 'dropClaim', id: 'old', center: [-79.4, 43.6] },
      { action: 'dropClaim', id: 'fresh', center: [-79.3, 43.7] },
    ]
    const queued: QueuedMapAction[] = [
      { action: 'dropClaim', detail: saved[1] },
    ]
    expect(claimReplaysBeforeQueuedActions(saved, queued)).toEqual([saved[0]])
  })

  it('de-duplicates valid id-less claims by the center App uses for identity', () => {
    const oldClaim = { action: 'dropClaim', center: [-79.4, 43.6] }
    const freshClaim = { action: 'dropClaim', center: [-79.3, 43.7] }
    expect(claimReplaysBeforeQueuedActions(
      [oldClaim, freshClaim],
      [{ action: 'dropClaim', detail: { center: [-79.3, 43.7] } }],
    )).toEqual([oldClaim])
  })
})
