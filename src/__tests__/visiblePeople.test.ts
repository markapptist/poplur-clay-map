import { describe, expect, it } from 'vitest'
import { visiblePeopleFromRealtimePosts } from '../visiblePeople'
import type { NativeFeedPost } from '../nativeFeedPosts'

/**
 * The roster is the Map and the Feed, folded into people.
 *
 * It must not be able to disagree with them, which is why it imports the same
 * reach predicate rather than carrying its own. These tests pin the folding
 * and the ordering; the reach rule itself is tested where it lives.
 */
const VIEWER: [number, number] = [-79.3811, 43.6487] // the deterministic preview origin

function post(over: Partial<NativeFeedPost>): NativeFeedPost {
  return {
    id: 'p', ownerId: 'owner', mediaURL: 'https://cdn/x.jpg', mediaType: 'photo',
    username: '@someone', channelId: 'food', createdAtMillis: 1,
    locationVisibility: 'approximate',
    originLongitude: -79.3830, originLatitude: 43.6530, // ~0.5km from VIEWER
    radiusMeters: 5_000,
    ...over,
  }
}

describe('the people you can see', () => {
  it('folds many pops by owner into one person', () => {
    // Production already holds an account with 29 posts under 14 handles.
    // Keyed on ownerId, that is one row; keyed on handle it is fourteen.
    const rows = visiblePeopleFromRealtimePosts([
      post({ id: 'a', ownerId: 'same', username: '@one' }),
      post({ id: 'b', ownerId: 'same', username: '@two' }),
      post({ id: 'c', ownerId: 'same', username: '@three' }),
    ], VIEWER, null)
    expect(rows).toHaveLength(1)
    expect(rows[0].ownerId).toBe('same')
  })

  it('never lists you', () => {
    const rows = visiblePeopleFromRealtimePosts([
      post({ ownerId: 'me' }), post({ id: 'q', ownerId: 'them' }),
    ], VIEWER, 'me')
    expect(rows.map(r => r.ownerId)).toEqual(['them'])
  })

  it('drops a pop with no owner — there is nobody to address', () => {
    expect(visiblePeopleFromRealtimePosts([post({ ownerId: undefined })], VIEWER, null)).toEqual([])
  })

  it('fails closed with no viewer fix, exactly as the feed and map do', () => {
    // Without knowing where you are, nobody can be shown to be in reach of you.
    expect(visiblePeopleFromRealtimePosts([post({})], null, null)).toEqual([])
  })

  it('excludes somebody whose radius does not carry to you', () => {
    // ~0.5km away with a 100m radius reaches nobody here.
    expect(visiblePeopleFromRealtimePosts([post({ radiusMeters: 100 })], VIEWER, null)).toEqual([])
  })

  it('orders nearest first', () => {
    const rows = visiblePeopleFromRealtimePosts([
      post({ id: 'far', ownerId: 'far', originLatitude: 43.7000, radiusMeters: 20_000 }),
      post({ id: 'near', ownerId: 'near', originLatitude: 43.6490 }),
    ], VIEWER, null)
    expect(rows.map(r => r.ownerId)).toEqual(['near', 'far'])
  })

  it('demotes a world-radius owner below anyone actually nearby', () => {
    // A world radius reaches everyone on Earth. They are visible, so hiding
    // them would put the roster out of step with the map — but they are not
    // NEAR you and must never outrank somebody who is.
    const rows = visiblePeopleFromRealtimePosts([
      post({ id: 'w', ownerId: 'worldwide', radiusMeters: 6_371_000 }),
      post({ id: 'n', ownerId: 'nearby' }),
    ], VIEWER, null)
    expect(rows.map(r => r.ownerId)).toEqual(['nearby', 'worldwide'])
    expect(rows[1].worldwide).toBe(true)
    expect(rows[1].distanceMeters).toBeNull()
  })

  it('keeps the nearest pop as the reason a person is listed', () => {
    const rows = visiblePeopleFromRealtimePosts([
      post({ id: 'further', ownerId: 'x', originLatitude: 43.6600, radiusMeters: 20_000 }),
      post({ id: 'closest', ownerId: 'x', originLatitude: 43.6489 }),
    ], VIEWER, null)
    expect(rows[0].postId).toBe('closest')
  })

  it('caps the list rather than rendering an unbounded roster', () => {
    const many = Array.from({ length: 60 }, (_, i) => post({ id: `p${i}`, ownerId: `owner${i}` }))
    expect(visiblePeopleFromRealtimePosts(many, VIEWER, null)).toHaveLength(40)
    expect(visiblePeopleFromRealtimePosts(many, VIEWER, null, { limit: 5 })).toHaveLength(5)
  })
})
