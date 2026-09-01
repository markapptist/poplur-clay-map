import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  nativeProfilePhotoCandidates,
  nextProfilePhotoReloadRevision,
  probeProfilePhotoCandidate,
  probeProfilePhotoCandidates,
  refreshedProfilePhotoSource,
  usableProfilePhoto,
} from '../profilePhoto'

const profileSource = readFileSync(new URL('../ProfileTwin.tsx', import.meta.url), 'utf8')
const profileCss = readFileSync(new URL('../ProfileTwin.module.css', import.meta.url), 'utf8')

describe('profile photo reload sources', () => {
  it('busts a stale URL cache without discarding existing signed parameters', () => {
    const refreshed = new URL(refreshedProfilePhotoSource(
      'https://firebasestorage.example/photo.jpg?token=abc123',
      7,
    ))
    expect(refreshed.searchParams.get('token')).toBe('abc123')
    expect(refreshed.searchParams.get('poplurPhotoReload')).toBe('7')
  })

  it('keeps an on-device data photo unchanged', () => {
    const data = 'data:image/jpeg;base64,AAAA'
    expect(refreshedProfilePhotoSource(data, 9)).toBe(data)
  })

  it('accepts only supported durable image sources', () => {
    expect(usableProfilePhoto('poplur-clay://app/captures/profile.jpg')).toBeTruthy()
    expect(usableProfilePhoto('https://example.com/profile.jpg')).toBeTruthy()
    expect(usableProfilePhoto('javascript:alert(1)')).toBeNull()
  })

  it('retains the last-good portrait and cache when inline bytes are corrupt', () => {
    let visiblePhoto = 'data:image/jpeg;base64,LAST_GOOD'
    let cachedPhoto = visiblePhoto
    let rejected = false
    const image = { onload: null as (() => void) | null, onerror: null as (() => void) | null, src: '' }

    probeProfilePhotoCandidate('data:image/jpeg;base64,TRUNCATED', {
      onDecoded: photo => {
        visiblePhoto = photo
        cachedPhoto = photo
      },
      onRejected: () => { rejected = true },
    }, () => image)
    image.onerror?.()

    expect(rejected).toBe(true)
    expect(visiblePhoto).toBe('data:image/jpeg;base64,LAST_GOOD')
    expect(cachedPhoto).toBe('data:image/jpeg;base64,LAST_GOOD')
  })

  it('prefers canonical native aliases and retains legacy photo as a decode fallback', () => {
    const candidates = nativeProfilePhotoCandidates({
      photo: 'data:image/jpeg;base64,LEGACY',
      profilePictureURL: 'https://example.com/canonical.jpg',
      photoURL: 'https://example.com/alternate.jpg',
    })
    expect(candidates).toEqual([
      'https://example.com/canonical.jpg',
      'https://example.com/alternate.jpg',
      'data:image/jpeg;base64,LEGACY',
    ])
    const images: Array<{
      onload: (() => void) | null
      onerror: (() => void) | null
      src: string
    }> = []
    let accepted: string | null = null
    probeProfilePhotoCandidates(candidates, {
      onDecoded: photo => { accepted = photo },
    }, () => {
      const image = { onload: null, onerror: null, src: '' }
      images.push(image)
      return image
    })
    images[0].onerror?.()
    images[1].onerror?.()
    images[2].onload?.()
    expect(accepted).toBe('data:image/jpeg;base64,LEGACY')

    expect(nativeProfilePhotoCandidates({
      photo: 'javascript:alert(1)',
      avatarUrl: 'data:image/jpeg;base64,VALID',
    })).toEqual(['data:image/jpeg;base64,VALID'])
  })

  it('uses a cache nonce that stays unique across retries and remounts', () => {
    expect(nextProfilePhotoReloadRevision(0, 1_000)).toBe(1_000)
    expect(nextProfilePhotoReloadRevision(1_000, 1_000)).toBe(1_001)
    // A fresh component starts at zero but still cannot repeat the old URL.
    expect(nextProfilePhotoReloadRevision(0, 2_000)).toBe(2_000)
  })

  it('mirrors only the front capture preview and keeps the AR overlay aligned', () => {
    const capture = profileSource.slice(
      profileSource.indexOf('const captureSurface ='),
      profileSource.indexOf('// ── Sharing the open post'),
    )
    expect(capture).toContain(
      "className={facingMode === 'user' ? styles.video : `${styles.video} ${styles.videoBack}`}",
    )
    expect(capture).toContain("mirrored={facingMode === 'user'}")

    const frontPreviewRule = profileCss.match(/\.video\s*\{([\s\S]*?)\}/)?.[1] ?? ''
    const backPreviewRule = profileCss.match(/\.videoBack\s*\{([\s\S]*?)\}/)?.[1] ?? ''
    expect(frontPreviewRule).toContain('scaleX(-1)')
    expect(backPreviewRule).not.toContain('scaleX(-1)')
  })

  it('keeps active selfie video, poster underlay, and parked fallback in one orientation', () => {
    const portrait = profileSource.slice(
      profileSource.indexOf('const ownProfileMediaClassName'),
      profileSource.indexOf('<h1 className={styles.username}>'),
    )
    expect(portrait).toContain(
      'const ownProfileMediaClassName = selfieVideo\n    ? `${styles.photo} ${styles.selfieMirrored}`\n    : styles.photo',
    )
    expect(portrait.match(/className=\{ownProfileMediaClassName\}/g)).toHaveLength(2)
    expect(portrait).toContain('styles.selfiePosterUnderlay')
    expect(portrait).toContain('styles.selfieMirrored')
    expect(profileCss.match(/\.selfieMirrored\s*\{([\s\S]*?)\}/)?.[1]).toContain('scaleX(-1)')
  })

  it('captures the poster in source orientation without applying a second mirror', () => {
    const posterCapture = profileSource.slice(
      profileSource.indexOf('const captureSelfiePoster ='),
      profileSource.indexOf('const previewVideo ='),
    )
    expect(posterCapture).toContain('context.drawImage(video, sx, sy, sourceEdge, sourceEdge, 0, 0, edge, edge)')
    expect(posterCapture).not.toContain('context.scale(-1')
    expect(posterCapture).not.toContain('context.translate(')
  })
})
