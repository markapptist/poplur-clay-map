// A7: calls that ring when Poplur is closed. Android's own ringing screen
// answers a call before this page exists; the page then joins it from
// `poplurCallAnswer`. These pin the page's half of that handshake and that every
// ring window agrees across the page, the caller, the Android notification and
// the server's push.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const home = read('src/HomeTwin.tsx')
const webCall = read('src/webCall.ts')
const android = read('../Poplur2025-Android/app/src/main/java/com/apptists/poplur2025/call/IncomingCallNotifier.kt')
const androidActivity = read('../Poplur2025-Android/app/src/main/java/com/apptists/poplur2025/PostLoginWebActivity.kt')
const server = read('../Poplur2025-iOS/functions/src/callNotifications.ts')

describe('a call answered on the phone\'s ringing screen', () => {
  it('is joined from poplurCallAnswer without ringing again', () => {
    const handler = home.slice(home.indexOf("event.data.type === 'poplurCallAnswer'"), home.indexOf("event.data.type === 'poplurCallIncoming'"))
    expect(handler).toContain('acceptIncomingCallRef.current({')
    // Never while another call is ringing in the page or already live.
    expect(handler).toContain("callState().phase !== 'idle'")
    expect(handler).toContain('incomingCallIdRef.current !== answeredId')
    expect(home).toContain('acceptIncomingCallRef.current = acceptIncomingCall')
  })

  it('is not declined as busy when its ringing document arrives afterwards', () => {
    const incoming = home.slice(home.indexOf("event.data.type === 'poplurCallIncoming'"))
    const guard = incoming.indexOf('if (callState().callId === timedCallId) return')
    const busy = incoming.indexOf("callState().phase !== 'idle'")
    expect(guard).toBeGreaterThan(0)
    expect(guard).toBeLessThan(busy)
  })

  it('is the message the Android activity sends once Home is ready', () => {
    expect(androidActivity).toContain('.put("type", "poplurCallAnswer")')
    expect(androidActivity).toMatch(/deliverPendingDMDeepLink\(\)\s*\n\s*deliverPendingPostFocus\(\)\s*\n\s*deliverPendingCallAnswer\(\)/)
  })
})

describe('every ring window is the same 45 seconds', () => {
  it('the caller, the callee page, the Android ring and the server push agree', () => {
    expect(webCall).toContain('const OUTGOING_NO_ANSWER_MS = 45_000')
    expect(home).toMatch(/The caller's own window \(webCall\.ts OUTGOING_NO_ANSWER_MS\)\.\s*\n\s*\}, 45_000\)/)
    expect(android).toContain('const val RING_TIMEOUT_MS = 45_000L')
    expect(server).toContain('export const RING_TTL_MS = 45_000;')
  })
})
