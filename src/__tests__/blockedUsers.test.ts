import { beforeEach, describe, expect, it } from 'vitest'
import { blockUser, blockedUserEntries, blockedUsersSnapshot, isUserBlocked, onBlockedUsersChange, resetBlockedUsersForTests, unblockUser } from '../blockedUsers'
import { visitedProfilePhoto } from '../profileRealtimePosts'

describe('blocking someone from their profile', () => {
  beforeEach(() => resetBlockedUsersForTests())

  it('keeps the Settings snapshot stable between writes', async () => {
    const empty = blockedUserEntries()
    expect(blockedUserEntries()).toBe(empty)
    await blockUser({ username: '@snapshot-test' })
    const blocked = blockedUserEntries()
    expect(blocked).not.toBe(empty)
    expect(blockedUserEntries()).toBe(blocked)
    await unblockUser({ username: '@snapshot-test' })
    expect(blockedUserEntries()).not.toBe(blocked)
    expect(blockedUserEntries()).toBe(blockedUserEntries())
  })

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

describe('unblocking', () => {
  it('lifts a uid block locally at once, and a handle-only block on the handle', async () => {
    resetBlockedUsersForTests()
    await blockUser({ uid: 'uid-a', username: '@Alpha' })
    await blockUser({ username: '@handle.only' })
    expect(isUserBlocked('uid-a')).toBe(true)
    expect(isUserBlocked(null, '@handle.only')).toBe(true)
    expect(blockedUserEntries()).toHaveLength(2)

    await unblockUser({ uid: 'uid-a' })
    expect(isUserBlocked('uid-a')).toBe(false)
    expect(isUserBlocked(null, '@handle.only')).toBe(true)

    await unblockUser({ username: 'HANDLE.only' })
    expect(isUserBlocked(null, '@handle.only')).toBe(false)
    expect(blockedUserEntries()).toHaveLength(0)
  })

  it('lists what Settings shows: the uid when known, the handle beside it', async () => {
    resetBlockedUsersForTests()
    await blockUser({ uid: 'uid-b', username: '@Bravo' })
    expect(blockedUserEntries()).toEqual([{ uid: 'uid-b', handle: 'bravo' }])
  })
})
