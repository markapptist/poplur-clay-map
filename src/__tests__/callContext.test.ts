import { describe, expect, it } from 'vitest'
import {
  callContextIsOwned,
  DEFAULT_CALL_CONTEXT,
  normalizeCallContext,
} from '../callContext'

describe('call context', () => {
  it('keeps legacy and unknown calls on the default call surface', () => {
    expect(normalizeCallContext(undefined)).toBe(DEFAULT_CALL_CONTEXT)
    expect(normalizeCallContext('')).toBe(DEFAULT_CALL_CONTEXT)
    expect(normalizeCallContext('profile')).toBe(DEFAULT_CALL_CONTEXT)
  })

  it('preserves the scoped House owner across the signalling wire', () => {
    expect(normalizeCallContext('house')).toBe('house')
  })

  it('hides global controls only for a House call while House is visible', () => {
    expect(callContextIsOwned('house', 'house')).toBe(true)
    expect(callContextIsOwned('default', 'house')).toBe(false)
    expect(callContextIsOwned('house', undefined)).toBe(false)
  })
})
