import { authToken, requestAuthToken } from './nativeAuth'
import { isNativeShell } from './nativeBridge'

/**
 * What this person has asked to be told about.
 *
 * The switches live on the ACCOUNT, not the device: the server reads them
 * before it sends, so a muted notification never leaves Google's side and never
 * lights the phone. That also means the choice survives a reinstall and reaches
 * every phone they sign in on.
 *
 * They gate the push only. The Notifications screen keeps showing everything —
 * "stop buzzing me about views" is not "hide views from me".
 */

const URL = 'https://us-central1-poplur2025.cloudfunctions.net/notificationPreferences'

export interface NotificationPrefs {
  messages: boolean
  engagement: 'every' | 'off'
  radius: 'daily' | 'off'
}

/** Absent means permissive, exactly as the server reads it. An account that has
 *  never touched these behaves as it always did. */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = Object.freeze({
  messages: true,
  engagement: 'every',
  radius: 'daily',
})

/** Read a server answer defensively: one malformed switch falls back to its own
 *  default rather than discarding the others. */
export function prefsFromResponse(value: unknown): NotificationPrefs | null {
  const prefs = (value as { prefs?: unknown } | null)?.prefs as
    | Partial<Record<keyof NotificationPrefs, unknown>>
    | undefined
  if (!prefs || typeof prefs !== 'object') return null
  return {
    messages: prefs.messages === false ? false : true,
    engagement: prefs.engagement === 'off' ? 'off' : 'every',
    radius: prefs.radius === 'off' ? 'off' : 'daily',
  }
}

/** The shell owns auth on a phone; the browser preview signs in through the web
 *  SDK. Same two paths every other server call here uses. */
async function token(): Promise<string | null> {
  if (!isNativeShell()) {
    const { webAuth } = await import('./webFirebase')
    return webAuth().currentUser?.getIdToken() ?? null
  }
  if (authToken()) return authToken()
  return new Promise(resolve => {
    const finish = () => {
      window.clearTimeout(timer)
      window.removeEventListener('poplur-native-auth-token', finish)
      resolve(authToken())
    }
    const timer = window.setTimeout(finish, 1_500)
    window.addEventListener('poplur-native-auth-token', finish, { once: true })
    requestAuthToken()
  })
}

async function call(set?: Partial<NotificationPrefs>): Promise<NotificationPrefs | null> {
  const bearer = await token()
  if (!bearer) return null
  const response = await fetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ data: set ? { set } : {} }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error('Preferences unavailable')
  return prefsFromResponse((await response.json()).result)
}

/** Current switches, or null when they cannot be read — the caller shows that
 *  as unavailable rather than drawing defaults the account may not hold. */
export function readNotificationPrefs(): Promise<NotificationPrefs | null> {
  return call()
}

/** Change one switch. The server answers with the whole set, so the screen
 *  renders what was actually stored rather than what it hoped for. */
export function writeNotificationPref(
  patch: Partial<NotificationPrefs>,
): Promise<NotificationPrefs | null> {
  return call(patch)
}
