import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { NativeFeedPost } from '../nativeFeedPosts'
import { contactsFromRealtimePosts } from '../webContacts'
import { houseGuestsFromRealtimePosts } from '../webHouseGuests'

const HERE = { lat: 43.6487, lng: -79.3811 }

function post(overrides: Partial<NativeFeedPost> = {}): NativeFeedPost {
  return {
    id: 'post-a',
    ownerId: 'alice',
    mediaURL: 'https://example.com/post.jpg',
    mediaType: 'photo',
    username: '@alice',
    channelId: 'live',
    createdAtMillis: 1,
    locationVisibility: 'approximate',
    originLatitude: HERE.lat,
    originLongitude: HERE.lng,
    ...overrides,
  }
}

describe('realtime Phone and House people discovery', () => {
  it('fails honestly empty after a full snapshot deletion', () => {
    expect(contactsFromRealtimePosts([], 'me', HERE, 5)).toEqual([])
    expect(houseGuestsFromRealtimePosts([], 'me', HERE, 5)).toEqual([])

    const beforeDelete = [post()]
    expect(contactsFromRealtimePosts(beforeDelete, 'me', HERE, 5)).toHaveLength(1)
    expect(houseGuestsFromRealtimePosts(beforeDelete, 'me', HERE, 5)).toHaveLength(1)
    expect(contactsFromRealtimePosts([], 'me', HERE, 5)).toEqual([])
    expect(houseGuestsFromRealtimePosts([], 'me', HERE, 5)).toEqual([])
  })

  it('removes a person immediately when their changed post hides its origin', () => {
    const publicPost = post()
    const hiddenPost = post({
      locationVisibility: 'hidden',
      originLatitude: undefined,
      originLongitude: undefined,
    })

    expect(contactsFromRealtimePosts([publicPost], 'me', HERE, 5)).toHaveLength(1)
    expect(houseGuestsFromRealtimePosts([publicPost], 'me', HERE, 5)).toHaveLength(1)
    expect(contactsFromRealtimePosts([hiddenPost], 'me', HERE, 5)).toEqual([])
    expect(houseGuestsFromRealtimePosts([hiddenPost], 'me', HERE, 5)).toEqual([])
  })

  it('requires a signed-in viewer, valid public coordinates, and actual radius reach', () => {
    const outside = post({ id: 'outside', ownerId: 'outside', originLatitude: 44.2 })
    const malformed = post({ id: 'malformed', ownerId: 'malformed', originLongitude: 181 })
    const self = post({ id: 'self', ownerId: 'me' })

    expect(contactsFromRealtimePosts([post()], null, HERE, 50)).toEqual([])
    expect(houseGuestsFromRealtimePosts([post()], null, HERE, 50)).toEqual([])
    expect(contactsFromRealtimePosts([outside, malformed, self], 'me', HERE, 5)).toEqual([])
    expect(houseGuestsFromRealtimePosts([outside, malformed, self], 'me', HERE, 5)).toEqual([])
  })

  it('deduplicates accounts by nearest post without returning coordinates', () => {
    const farther = post({ id: 'farther', originLatitude: 43.67, username: '@alice-old' })
    const nearer = post({ id: 'nearer', originLatitude: 43.65, username: '@alice-near' })
    const bob = post({ id: 'bob', ownerId: 'bob', username: '@bob', originLatitude: 43.66 })

    const contacts = contactsFromRealtimePosts([farther, bob, nearer], 'me', HERE, 20)
    const guests = houseGuestsFromRealtimePosts([farther, bob, nearer], 'me', HERE, 20)

    expect(contacts).toHaveLength(2)
    expect(contacts[0]).toMatchObject({ id: 'alice', handle: '@alice-near', callable: true })
    expect(guests).toHaveLength(2)
    expect(guests[0]).toMatchObject({ id: 'alice', name: '@alice-near', preview: false })
    expect(JSON.stringify({ contacts, guests })).not.toMatch(/origin|latitude|longitude|coords/i)
  })

  it('wires both screens to the shared snapshot without fixture people or one-shot contact queries', () => {
    const phone = readFileSync(new URL('../PhoneScreen.tsx', import.meta.url), 'utf8')
    const house = readFileSync(new URL('../HouseScreen.tsx', import.meta.url), 'utf8')
    const contactSelector = readFileSync(new URL('../webContacts.ts', import.meta.url), 'utf8')
    const guestSelector = readFileSync(new URL('../webHouseGuests.ts', import.meta.url), 'utf8')

    expect(phone).toContain('useSyncExternalStore')
    expect(house).toContain('useSyncExternalStore')
    expect(phone).not.toContain('OTHER_POPS')
    expect(house).not.toContain('previewHouseGuests')
    expect(contactSelector).not.toContain("from 'firebase/firestore'")
    expect(guestSelector).not.toContain("from 'firebase/firestore'")
    expect(contactSelector).not.toContain('getDocs(')
    expect(guestSelector).not.toContain('getDocs(')
  })
})
