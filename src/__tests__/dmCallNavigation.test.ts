import { describe, expect, it } from 'vitest'
import {
  INITIAL_DM_PHONE_RETURN_STATE,
  advanceDMPhoneReturn,
  createDMPhoneCallRoute,
  dmPhoneReturnThreadId,
  resolveDMAutoCallPeer,
  resolvePendingDMThreadId,
} from '../dmCallNavigation'

describe('DM Phone return navigation', () => {
  it('does not leave Mail on the subscription\'s initial idle snapshot', () => {
    const result = advanceDMPhoneReturn(INITIAL_DM_PHONE_RETURN_STATE, 'idle')
    expect(result).toEqual({
      state: INITIAL_DM_PHONE_RETURN_STATE,
      shouldReturn: false,
    })
  })

  it('returns to the originating chat when an active call ends', () => {
    const started = advanceDMPhoneReturn(INITIAL_DM_PHONE_RETURN_STATE, 'calling')
    const ended = advanceDMPhoneReturn(started.state, 'ended')
    expect(ended.shouldReturn).toBe(true)
    expect(ended.state).toEqual({ began: true, returned: true })
  })

  it('returns only once when ended settles to idle', () => {
    const started = advanceDMPhoneReturn(INITIAL_DM_PHONE_RETURN_STATE, 'connected')
    const ended = advanceDMPhoneReturn(started.state, 'ended')
    const idle = advanceDMPhoneReturn(ended.state, 'idle')
    expect(ended.shouldReturn).toBe(true)
    expect(idle.shouldReturn).toBe(false)
  })

  it('reopens a seeded browser chat but waits for native authority', () => {
    const ids = ['thread-a', 'thread-b']
    expect(resolvePendingDMThreadId('thread-b', ids, true)).toBe('thread-b')
    expect(resolvePendingDMThreadId('thread-b', ids, false)).toBeNull()
    expect(resolvePendingDMThreadId('missing', ids, true)).toBeNull()
  })

  it('dials the exact DM peer even when the radius address book is empty', () => {
    expect(resolveDMAutoCallPeer(
      { id: 'peer-42', name: '@saved-chat' },
      [],
    )).toEqual({ id: 'peer-42', handle: '@saved-chat', contactIndex: -1 })
  })

  it('carries the exact originating thread through Phone call mode', () => {
    const route = createDMPhoneCallRoute('peer-42', '@saved-chat', 'thread-original')
    expect(dmPhoneReturnThreadId(route)).toBe('thread-original')
    expect(dmPhoneReturnThreadId(null)).toBeNull()
  })
})
