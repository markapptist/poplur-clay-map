import { describe, expect, it } from 'vitest'
import {
  createClientPostId,
  isClientPostId,
  publicCoordinate,
  validatePublishPrivacy,
} from '../publishing'

describe('publishing contract', () => {
  it('keeps a bounded post identity suitable for Firestore and Storage paths', () => {
    const id = createClientPostId(() => '123e4567-e89b-12d3-a456-426614174000')
    expect(id).toBe('post-123e4567-e89b-12d3-a456-426614174000')
    expect(isClientPostId(id)).toBe(true)
    expect(isClientPostId('post/escape')).toBe(false)
  })

  it('rounds approximate locations but leaves explicitly exact locations alone', () => {
    expect(publicCoordinate(43.653226, 'approximate')).toBe(43.653)
    expect(publicCoordinate(-79.383184, 'approximate')).toBe(-79.383)
    expect(publicCoordinate(43.653226, 'exact')).toBe(43.653226)
  })

  it('requires an honest rights confirmation before publishing', () => {
    expect(validatePublishPrivacy({
      audience: 'public',
      locationVisibility: 'approximate',
      rightsAttested: false,
    })).toMatch(/permission/i)
    expect(validatePublishPrivacy({
      audience: 'public',
      locationVisibility: 'exact',
      rightsAttested: true,
    })).toBeNull()
  })
})
