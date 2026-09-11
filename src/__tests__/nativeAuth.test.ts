// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { authToken, authUid } from '../nativeAuth'

// Shape a token the way Firebase does — header.payload.signature, base64url,
// no padding — so the decoder is exercised on the real alphabet and padding.
const b64url = (value: object) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const token = (claims: object) => `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url(claims)}.sig`
const push = (detail: unknown) => window.dispatchEvent(new CustomEvent('poplur-native-auth-token', { detail }))

describe('the uid inside the shell token', () => {
  it('is null before the shell has pushed anything', () => {
    expect(authUid()).toBeNull()
  })
  it('reads sub, and falls back to user_id, off a pushed token', () => {
    push({ token: token({ sub: 'abc123', user_id: 'abc123', exp: 1 }), expiresIn: 3600 })
    expect(authToken()).not.toBeNull()
    expect(authUid()).toBe('abc123')
    push({ token: token({ user_id: 'only-user-id' }), expiresIn: 3600 })
    expect(authUid()).toBe('only-user-id')
  })
  it('survives a token whose payload needs padding or has url-safe characters', () => {
    // '>>>' and '???' encode to '+' and '/' in plain base64 — url-safe here.
    push({ token: token({ sub: 'x>>>???y', n: 1 }), expiresIn: 3600 })
    expect(authUid()).toBe('x>>>???y')
  })
  it('keeps the uid once the token has expired — the person did not change', () => {
    push({ token: token({ sub: 'stale-but-same' }), expiresIn: 0 })
    expect(authToken()).toBeNull()
    expect(authUid()).toBe('stale-but-same')
  })
  it('is null for garbage, and for a signed-out push', () => {
    push({ token: 'not.a.jwt', expiresIn: 3600 }); expect(authUid()).toBeNull()
    push({ token: '', expiresIn: 3600 }); expect(authUid()).toBeNull()
  })
})
