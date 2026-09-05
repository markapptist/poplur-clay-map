import { beforeEach, describe, expect, it } from 'vitest'
import { blockUser, blockedUsersSnapshot, isUserBlocked, onBlockedUsersChange, resetBlockedUsersForTests } from '../blockedUsers'
import { visitedProfilePhoto } from '../profileRealtimePosts'

describe('blocking someone from their profile', () => {
  beforeEach(() => resetBlockedUsersForTests())

  it('blocks by uid at once, remembers the handle, and tells subscribers', async () => {
    let told = 0
    const stop = onBlockedUsersChange(() => { told += 1 })
    const before = blockedUsersSnapshot()
    expect(isUserBlocked('u-orange', '@orange.peel')).toBe(false)
    expect(await blockUser({ uid: 'u-orange', username: '@orange.peel' })).toBe('local')
    expect(isUserBlocked('u-orange')).toBe(true)
    expect(isUserBlocked(undefined, 'ORANGE.PEEL')).toBe(true)
    expect(isUserBlocked('u-other', '@someone')).toBe(false)
    expect(blockedUsersSnapshot()).not.toBe(before)
    expect(told).toBe(1)
    stop()
  })

  it('blocks by handle alone when no uid is known, and refuses an empty block', async () => {
    expect(await blockUser({ uid: null, username: '@ghost' })).toBe('local')
    expect(isUserBlocked(null, '@ghost')).toBe(true)
    expect(await blockUser({ uid: '', username: '  ' })).toBe('local')
    expect(blockedUsersSnapshot().uids.size).toBe(0)
  })

  it("a visited profile's picture is the one their posts carry, or nothing — never a stand-in", () => {
    const rows = [
      { ownerId: 'u1', username: '@orange.peel', ownerAvatarURL: undefined },
      { ownerId: 'u2', username: '@glowgetter', ownerAvatarURL: 'https://cdn.example/glow.jpg' },
    ]
    expect(visitedProfilePhoto(rows, 'u2', '@glowgetter')).toBe('https://cdn.example/glow.jpg')
    expect(visitedProfilePhoto(rows, null, 'glowgetter')).toBe('https://cdn.example/glow.jpg')
    expect(visitedProfilePhoto(rows, 'u1', '@orange.peel')).toBeNull()
    expect(visitedProfilePhoto(rows, null, null)).toBeNull()
  })
})
