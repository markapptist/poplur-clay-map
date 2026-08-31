import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  claimReplaysBeforeQueuedActions,
  enqueueMapFallbackAction,
  nativeMapHandlesAction,
  type QueuedMapAction,
} from '../nativeMapFallback'

const dirname = path.dirname(fileURLToPath(import.meta.url))

describe('native map fallback routing', () => {
  it('keeps only complete MapKit actions native', () => {
    expect(nativeMapHandlesAction('locate')).toBe(true)
    expect(nativeMapHandlesAction('setZoom')).toBe(true)
    expect(nativeMapHandlesAction('engagement')).toBe(true)

    for (const action of [
      'search', 'tour', 'randomTour', 'pauseTour', 'resumeTour', 'setPopLevel', 'weather', 'directions',
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

  it('does not observe or rescan the document while the native map is hidden', () => {
    const source = fs.readFileSync(path.resolve(dirname, '../HomeTwin.tsx'), 'utf8')
    const effectStart = source.indexOf('// A transparent WKWebView is still a full-screen UIKit hit target.')
    const effectEnd = source.indexOf('const [mapTourTopics', effectStart)
    const effect = source.slice(effectStart, effectEnd)
    const hiddenGuard = effect.indexOf('if (!mapVisible)')

    expect(effectStart).toBeGreaterThan(-1)
    expect(effectEnd).toBeGreaterThan(effectStart)
    expect(hiddenGuard).toBeGreaterThan(-1)
    expect(effect.slice(hiddenGuard, effect.indexOf('let settleTimer', hiddenGuard)))
      .toContain('publishInactive()')
    expect(hiddenGuard).toBeLessThan(effect.indexOf('new ResizeObserver'))
    expect(hiddenGuard).toBeLessThan(effect.indexOf('new MutationObserver'))
    expect(effect).not.toContain("nativeHitSignatureRef.current = ''")
  })
})
