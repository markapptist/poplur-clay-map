import { useEffect, useSyncExternalStore } from 'react'
import { accountSnapshot, onAccountChange } from './accountStore'
import { authToken, requestAuthToken } from './nativeAuth'
import { isNativeShell } from './nativeBridge'

const URL = 'https://us-central1-poplur2025.cloudfunctions.net/appPresence'
export const PRESENCE_REFRESH_MS = 60_000
const MAX_AGE_MS = 120_000
let count: number | null = null
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
function publish(next: number | null) {
  if (count === next) return
  count = next
  listeners.forEach(listener => listener())
}

export function presenceCountFromResponse(value: unknown): number | null {
  const result = value as { peopleOnline?: unknown; validForMs?: unknown } | null
  return result && Number.isSafeInteger(result.peopleOnline) && Number(result.peopleOnline) >= 0
    && typeof result.validForMs === 'number' && result.validForMs > 0 && result.validForMs <= MAX_AGE_MS
    ? Number(result.peopleOnline) : null
}

export function useOnlinePeople(): number | null {
  return useSyncExternalStore(subscribe, onlinePeopleSnapshot, () => null)
}
export const onlinePeopleSnapshot = () => count

async function tokenForPresence(): Promise<string | null> {
  if (!isNativeShell()) {
    const { webAuth } = await import('./webFirebase')
    return webAuth().currentUser?.getIdToken() ?? null
  }
  if (authToken()) return authToken()
  return new Promise(resolve => {
    const finish = () => {
      clearTimeout(timeout)
      window.removeEventListener('poplur-native-auth-token', finish)
      resolve(authToken())
    }
    const timeout = setTimeout(finish, 1500)
    window.addEventListener('poplur-native-auth-token', finish, { once: true })
    requestAuthToken()
  })
}

/** One reporter belongs to the top-level app, never each screen or iframe. */
export function startAppPresence(): () => void {
  if (window.parent !== window) return () => {}
  const session = crypto.randomUUID()
  let sequence = 0
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let expiry: ReturnType<typeof setTimeout> | undefined
  let uid: string | null = null
  let token: string | null = null
  let foreground = false
  let pageActive = true
  let nativeActive = window.__poplurNativeAppActive !== false
  let revision = 0
  const isActive = () => pageActive && !document.hidden && nativeActive

  const send = async (bearer: string, active: boolean, requestSequence: number) => {
    const response = await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ data: { session, sequence: requestSequence, active } }),
      keepalive: !active,
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error('Presence unavailable')
    return (await response.json()).result as unknown
  }
  const offline = () => {
    if (foreground && token) void send(token, false, ++sequence).catch(() => {})
    foreground = false
  }
  const pulse = async () => {
    const ownRevision = revision
    const ownUid = uid
    if (!ownUid || !isActive() || disposed) return
    try {
      const bearer = await tokenForPresence()
      if (!bearer || ownRevision !== revision || disposed || !isActive()) return
      token = bearer
      foreground = true
      const result = await send(bearer, true, ++sequence)
      if (ownRevision !== revision || disposed || !isActive()) return
      const next = presenceCountFromResponse(result)
      publish(next)
      clearTimeout(expiry)
      if (next !== null) expiry = setTimeout(() => publish(null), MAX_AGE_MS)
    } catch {
      // A known number may survive a brief network interruption; its expiry
      // still clears it. Unknown must never be converted into a fabricated 0.
    } finally {
      if (!disposed && ownRevision === revision && isActive() && uid === ownUid) {
        timer = setTimeout(() => { void pulse() }, PRESENCE_REFRESH_MS)
      }
    }
  }
  const sync = () => {
    const account = accountSnapshot()
    const nextUid = account.authenticated ? account.uid : null
    revision++
    clearTimeout(timer)
    if (uid !== nextUid || !isActive()) offline()
    if (uid !== nextUid || !isActive()) { clearTimeout(expiry); publish(null) }
    if (uid !== nextUid) token = null
    uid = nextUid
    if (uid && isActive()) void pulse()
  }
  const lifecycle = (event: Event) => {
    const active = (event as CustomEvent<{ active?: boolean }>).detail?.active
    if (typeof active === 'boolean') { nativeActive = active; sync() }
  }
  const hide = () => { pageActive = false; sync() }
  const show = () => { pageActive = true; sync() }
  const offAccount = onAccountChange(account => {
    if ((account.authenticated ? account.uid : null) !== uid) sync()
  })
  document.addEventListener('visibilitychange', sync)
  window.addEventListener('poplur-native-app-lifecycle', lifecycle)
  window.addEventListener('pagehide', hide)
  window.addEventListener('pageshow', show)
  window.addEventListener('online', sync)
  sync()
  return () => {
    disposed = true
    revision++
    offline()
    clearTimeout(timer); clearTimeout(expiry)
    offAccount()
    document.removeEventListener('visibilitychange', sync)
    window.removeEventListener('poplur-native-app-lifecycle', lifecycle)
    window.removeEventListener('pagehide', hide)
    window.removeEventListener('pageshow', show)
    window.removeEventListener('online', sync)
    publish(null)
  }
}

export function useAppPresenceReporter(): void { useEffect(startAppPresence, []) }
