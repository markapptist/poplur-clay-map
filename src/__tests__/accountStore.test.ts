import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  accountSnapshot,
  clearAccountProfile,
  onAccountChange,
  resetAccountStoreForTests,
  setAccountAuth,
  setAccountProfile,
} from '../accountStore'

afterEach(() => {
  resetAccountStoreForTests()
  vi.unstubAllGlobals()
})

describe('account store', () => {
  it('keeps auth identity separate from profile metadata', () => {
    setAccountProfile({ username: '@clay.mark', displayName: 'Mark' })
    setAccountAuth({ uid: 'firebase-user-1', displayName: 'Mark', source: 'firebase' })

    expect(accountSnapshot()).toMatchObject({
      uid: 'firebase-user-1',
      authenticated: true,
      username: 'clay.mark',
      displayName: 'Mark',
      source: 'firebase',
    })

    setAccountAuth(null)
    expect(accountSnapshot()).toMatchObject({
      uid: null,
      authenticated: false,
      username: 'clay.mark',
    })
  })

  it('normalizes profile patches and notifies subscribers', () => {
    const seen: string[] = []
    const unsubscribe = onAccountChange(value => seen.push(value.username ?? ''))

    setAccountProfile({ username: ' @new.name ', business: true }, 'native')

    expect(accountSnapshot()).toMatchObject({ username: 'new.name', business: true })
    expect(seen).toEqual(['', 'new.name'])
    unsubscribe()
  })

  it('can clear the local profile cache without changing auth', () => {
    setAccountAuth({ uid: 'native-user-1', source: 'native' })
    setAccountProfile({ username: 'keep-me', photoURL: 'https://example.com/photo.jpg' })

    clearAccountProfile()

    expect(accountSnapshot()).toMatchObject({
      uid: 'native-user-1',
      authenticated: true,
      username: null,
      photoURL: null,
    })
  })
})
