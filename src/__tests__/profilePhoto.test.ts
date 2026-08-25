import { describe, expect, it } from 'vitest'
import { refreshedProfilePhotoSource, usableProfilePhoto } from '../profilePhoto'

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
})
