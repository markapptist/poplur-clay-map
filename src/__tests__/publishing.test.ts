import { describe, expect, it } from 'vitest'
import {
  createClientPostId,
  isClientPostId,
  publicCoordinate,
  publicCoordinateCell,
  validatePublishPrivacy,
} from '../publishing'

describe('publishing contract', () => {
  it('keeps a bounded post identity suitable for Firestore and Storage paths', () => {
    const id = createClientPostId(() => '123e4567-e89b-12d3-a456-426614174000')
    expect(id).toBe('post-123e4567-e89b-12d3-a456-426614174000')
    expect(isClientPostId(id)).toBe(true)
    expect(isClientPostId('post/escape')).toBe(false)
  })

  it('publishes only a deterministic coarse cell, never an exact coordinate', () => {
    expect(publicCoordinate(43.653226)).toBe(43.653)
    expect(publicCoordinate(-79.383184)).toBe(-79.383)
    expect(publicCoordinateCell(43.653226)).toBe(43653)
    expect(publicCoordinateCell(-79.383184)).toBe(-79383)
  })

  it('requires an honest rights confirmation before publishing', () => {
    expect(validatePublishPrivacy({
      audience: 'public',
      locationVisibility: 'exact' as never,
      rightsAttested: true,
    })).toMatch(/public map area/i)
    expect(validatePublishPrivacy({
      audience: 'public',
      locationVisibility: 'approximate',
      rightsAttested: false,
    })).toMatch(/permission/i)
    expect(validatePublishPrivacy({
      audience: 'public',
      locationVisibility: 'hidden',
      rightsAttested: true,
    })).toBeNull()
  })
})
