import { describe, expect, it, vi } from 'vitest'
import { PoplurResourcePool } from '../resourcePool'

describe('PoplurResourcePool screen teardown', () => {
  it('revokes every live heavy resource at a screen boundary', () => {
    const pool = new PoplurResourcePool()
    const cameraRevoked = vi.fn()
    const decoderRevoked = vi.fn()
    const analysisRevoked = vi.fn()

    expect(pool.acquire('camera', 'camera-live', { onRevoke: cameraRevoked })).not.toBeNull()
    expect(pool.acquire('media-decoder', 'feed', { onRevoke: decoderRevoked })).not.toBeNull()
    expect(pool.acquire('analysis', 'camera-analysis', { onRevoke: analysisRevoked })).not.toBeNull()

    pool.releaseAll()

    expect(cameraRevoked).toHaveBeenCalledOnce()
    expect(decoderRevoked).toHaveBeenCalledOnce()
    expect(analysisRevoked).toHaveBeenCalledOnce()
  })

  it('keeps stale outgoing releases from touching the new screen owner', () => {
    const pool = new PoplurResourcePool()
    const outgoing = pool.acquire('media-decoder', 'feed-old')

    pool.releaseAll()
    const incoming = pool.acquire('media-decoder', 'feed-new')
    expect(incoming).not.toBeNull()

    outgoing?.release()
    expect(pool.acquire('media-decoder', 'unexpected-peer')).toBeNull()

    incoming?.release()
    expect(pool.acquire('media-decoder', 'next-screen')).not.toBeNull()
  })

  it('is idempotent after React cleanup releases an already-revoked lease', () => {
    const pool = new PoplurResourcePool()
    const revoked = vi.fn()
    const lease = pool.acquire('camera', 'camera-live', { onRevoke: revoked })

    pool.releaseAll()
    pool.releaseAll()
    lease?.release()
    lease?.release()

    expect(revoked).toHaveBeenCalledOnce()
    expect(pool.acquire('camera', 'camera-next')).not.toBeNull()
  })
})
