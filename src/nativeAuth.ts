// The signed-in identity, as far as the web layer is allowed to know it.
//
// The clay bundle has no Firebase SDK and no user object: the native shell owns
// auth. Anything that must prove WHO is asking — today, Meshy generation, which
// spends credits and is gated to admins and business accounts — needs a token
// the server can verify, and only the shell can mint one.
//
// So the shell pushes its Firebase ID token in, the same way it pushes
// detections and lifecycle. The web never stores it anywhere durable, never
// logs it, and never sends it anywhere except a Poplur endpoint: an ID token is
// a bearer credential, and localStorage is readable by anything else running in
// this document.

import { postNativeEvent } from './nativeBridge'

let idToken: string | null = null
let expiresAt = 0

if (typeof window !== 'undefined') {
  window.addEventListener('poplur-native-auth-token', event => {
    const detail = (event as CustomEvent).detail as { token?: string; expiresIn?: number } | undefined
    idToken = typeof detail?.token === 'string' && detail.token.length > 0 ? detail.token : null
    // Firebase ID tokens last an hour. Treat one as spent slightly early so a
    // long generation cannot start on a token that dies mid-poll.
    const lifetime = Number(detail?.expiresIn ?? 3600)
    expiresAt = Date.now() + Math.max(0, lifetime - 300) * 1000
  })
}

/** Null when signed out, when the shell has not pushed a token yet, or when the
 *  one we hold is too old to trust. Callers must treat null as "cannot ask". */
export function authToken(): string | null {
  if (!idToken) return null
  if (Date.now() >= expiresAt) return null
  return idToken
}

/** Ask the shell for a fresh token. It answers on poplur-native-auth-token.
 *  This goes over the NATIVE BRIDGE, not a window event: a window event stays
 *  inside this document, where the shell cannot hear it. */
export function requestAuthToken(): void {
  try {
    postNativeEvent({ type: 'requestAuthToken' })
  } catch { /* no shell listening — token stays null, callers handle it */ }
}
