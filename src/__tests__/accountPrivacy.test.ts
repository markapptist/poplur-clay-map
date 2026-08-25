import { afterEach, describe, expect, it } from 'vitest'
import {
  accountPrivacySnapshot,
  applyNativeAccountPrivacy,
  hidesPublicPostOrigin,
  onAccountPrivacyChange,
  resetAccountPrivacyForTests,
  setLocalAccountPrivacy,
} from '../accountPrivacy'

afterEach(resetAccountPrivacyForTests)

describe('account location privacy', () => {
  it('treats private account as location redaction, not profile visibility', () => {
    const snapshot = setLocalAccountPrivacy({ privateAccount: true })
    expect(snapshot).toMatchObject({ privateAccount: true, ghostMode: false })
    expect(hidesPublicPostOrigin(snapshot)).toBe(true)
  })

  it('keeps Ghost Mode as an independent temporary redaction control', () => {
    expect(hidesPublicPostOrigin({ privateAccount: false, ghostMode: true })).toBe(true)
    expect(hidesPublicPostOrigin({ privateAccount: false, ghostMode: false })).toBe(false)
  })

  it('settles from the native account record and notifies subscribers', () => {
    const seen: boolean[] = []
    const off = onAccountPrivacyChange(value => seen.push(value.privateAccount))
    applyNativeAccountPrivacy({ privateAccount: true, ghostMode: false })
    expect(accountPrivacySnapshot().privateAccount).toBe(true)
    expect(seen).toEqual([false, true])
    off()
  })
})
