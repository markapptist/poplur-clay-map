import { describe, expect, it } from 'vitest'
import {
  nextProfilePhotoReloadRevision,
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

  it('uses a cache nonce that stays unique across retries and remounts', () => {
    expect(nextProfilePhotoReloadRevision(0, 1_000)).toBe(1_000)
    expect(nextProfilePhotoReloadRevision(1_000, 1_000)).toBe(1_001)
    // A fresh component starts at zero but still cannot repeat the old URL.
    expect(nextProfilePhotoReloadRevision(0, 2_000)).toBe(2_000)
  })
})
