import { describe, expect, it } from 'vitest'
import {
  nativeProfilePhotoCandidates,
  nextProfilePhotoReloadRevision,
  probeProfilePhotoCandidate,
  probeProfilePhotoCandidates,
  refreshedProfilePhotoSource,
  usableProfilePhoto,
} from '../profilePhoto'

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
})
