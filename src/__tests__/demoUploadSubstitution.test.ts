import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { demoUploadDataUrl, demoUploadPool, randomDemoUploadPick } from '../demoFeedMedia'
import { setLiveSimulationEnabled } from '../simulationControl'

describe('test-run upload substitution', () => {
  beforeEach(() => setLiveSimulationEnabled(true))
  afterEach(() => setLiveSimulationEnabled(false))

  it('draws nothing while the simulation switch is off, so a real run uploads the real capture', () => {
    setLiveSimulationEnabled(false)
    expect(randomDemoUploadPick('photo')).toBeNull()
    expect(randomDemoUploadPick('video')).toBeNull()
  })

  it('preserves the capture kind', () => {
    // The composer has already told native `kind: media.kind`. Answering a
    // still with a clip produces a broken row rather than a demo one.
    expect(randomDemoUploadPick('photo', () => 0.5)?.kind).toBe('photo')
    expect(randomDemoUploadPick('video', () => 0.5)?.kind).toBe('video')
  })

  it('can reach every entry and never indexes off the end', () => {
    for (const kind of ['photo', 'video'] as const) {
      const pool = demoUploadPool(kind)
      expect(pool.length).toBeGreaterThan(0)
      const drawn = new Set<string>()
      for (let i = 0; i <= 100; i += 1) {
        const pick = randomDemoUploadPick(kind, () => i / 100)
        expect(pick).not.toBeNull()
        drawn.add(pick!.sourceId)
      }
      expect(drawn.size).toBe(pool.length)
      // Math.random() may return values arbitrarily close to 1.
      expect(randomDemoUploadPick(kind, () => 0.999999)).not.toBeNull()
    }
  })

  it('rejects a response whose bytes are not the media it promised', async () => {
    // The dev server answers a MISSING public/ file with 200 and an HTML body,
    // so `response.ok` is not the check — without a type check this uploaded an
    // HTML document as somebody's photo.
    const html = new Blob(['<!doctype html><title>not an image</title>'], { type: 'text/html' })
    const original = globalThis.fetch
    globalThis.fetch = (async () => new Response(html, {
      status: 200, headers: { 'content-type': 'text/html' },
    })) as typeof fetch
    try {
      const result = await demoUploadDataUrl({ kind: 'photo', url: '/missing.jpg', sourceId: 'x' })
      expect(result).toBeNull()
    } finally {
      globalThis.fetch = original
    }
  })
})
