import { describe, expect, it } from 'vitest'
import {
  hasDiscoverableHouseOrigin,
  normalizeHouseGuests,
  previewHouseGuests,
} from '../houseGuests'

describe('House nearby guests', () => {
  it('accepts only complete, strictly in-radius native contacts and excludes self', () => {
    const guests = normalizeHouseGuests({
      type: 'poplurPhoneContacts',
      contacts: [
        { id: 'me', name: '@me', inReach: true, distanceKm: 0 },
        { id: 'alice', name: '  @alice  ', inReach: true, distanceKm: 1.25 },
        { id: 'outside', name: '@outside', inReach: false, distanceKm: 0.2 },
        { id: 'string-boolean', name: '@almost', inReach: 'true', distanceKm: 0.1 },
        { id: '', name: '@missing', inReach: true, distanceKm: 0.3 },
        { id: 'nameless', name: ' ', inReach: true, distanceKm: 0.4 },
      ],
    }, 'me', 2)

    expect(guests).toEqual([{
      id: 'alice',
      name: '@alice',
      detail: '1.3 km away · in your radius',
      distanceKm: 1.25,
      preview: false,
    }])
  })

  it('deduplicates by uid, keeps the nearest valid distance, and strips source location data', () => {
    const guests = normalizeHouseGuests({ detail: { contacts: [
      {
        id: 'alice', name: '@alice-old', inReach: true, distanceKm: 4,
        latitude: 43.65, longitude: -79.38, coords: [-79.38, 43.65],
        detail: '43.65, -79.38',
      },
      { id: 'alice', name: '@alice-near', inReach: true, distanceKm: 0.35 },
      { id: 'bob', name: '@bob', inReach: true, distanceKm: Number.NaN },
      { id: 'bob', name: '@bob', inReach: true, distanceKm: -1 },
      { id: 'forged', name: '@forged', inReach: true, distanceKm: 25 },
    ] } }, null, 5)

    expect(guests).toHaveLength(1)
    expect(guests[0]).toMatchObject({ id: 'alice', name: '@alice-near', distanceKm: 0.35 })
    expect(guests.some(guest => 'latitude' in guest || 'longitude' in guest || 'coords' in guest)).toBe(false)
    expect(JSON.stringify(guests)).not.toContain('43.65, -79.38')
  })

  it('builds only radius-reachable board rows as clearly marked previews', () => {
    expect(previewHouseGuests(Number.NaN)).toEqual([])
    expect(previewHouseGuests(50, 0)).toEqual([])

    const guests = previewHouseGuests(50, 3)
    expect(guests).toHaveLength(3)
    expect(guests.every(guest => guest.preview)).toBe(true)
    expect(guests.every(guest => guest.distanceKm !== null && guest.distanceKm <= 50)).toBe(true)
    expect(guests.every(guest => guest.detail.endsWith('· preview'))).toBe(true)
    expect(guests.some(guest => 'coords' in guest || 'latitude' in guest || 'longitude' in guest)).toBe(false)
  })

  it('fails closed for hidden, private, ghost, legacy, and malformed post origins', () => {
    expect(hasDiscoverableHouseOrigin({ locationVisibility: 'approximate' })).toBe(true)
    expect(hasDiscoverableHouseOrigin({ locationVisibility: 'approximate', privateAccount: false })).toBe(true)
    expect(hasDiscoverableHouseOrigin({ locationVisibility: 'hidden' })).toBe(false)
    expect(hasDiscoverableHouseOrigin({ latitude: 43.6, longitude: -79.3 })).toBe(false)
    expect(hasDiscoverableHouseOrigin({ locationVisibility: 'approximate', privateAccount: true })).toBe(false)
    expect(hasDiscoverableHouseOrigin({ locationVisibility: 'approximate', ghostMode: true })).toBe(false)
    expect(hasDiscoverableHouseOrigin({
      locationVisibility: 'approximate',
      originHiddenByPrivateAccount: 'false',
    })).toBe(false)
  })
})
