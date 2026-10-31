import { isNativeShell, postNativeEvent } from './nativeBridge'

/**
 * Firebase Analytics, page side.
 *
 * Ownership is deliberately split once and never shared:
 *   • this page is the ONLY source of `screen_view` and of every in-app action
 *     event (pop_view, pop_engagement, pop_published, radius_change, dm_sent…);
 *   • the native shell owns `login` / `sign_up` / `purchase` and the SDK's
 *     automatic lifecycle events, and its automatic screen reporting is OFF.
 *
 * The page never loads gtag. The native SDK is the only transport: every call
 * here becomes one `analyticsEvent` / `analyticsUserProperty` bridge message
 * that the shell relays to Analytics.logEvent / setUserProperty, the same relay
 * shape as poplurWalletPassRequested. Outside a shell (browser preview, Test
 * Center iframe, headless probes) nothing is sent; in DEV the would-be call is
 * printed instead so it can be eyeballed.
 *
 * Two hard rules, enforced at this seam rather than trusted from callers:
 *   1. Only the top document reports. The map iframe shares this bundle AND
 *      the shell's bridge, so without the guard every screen_view would land
 *      twice.
 *   2. Params are shaped to GA4 limits before they cross: ≤25 params, names
 *      /^[a-z][a-z0-9_]{0,39}$/ without the firebase_/google_/ga_ prefixes,
 *      strings ≤100 characters, booleans as '1'/'0', finite numbers as-is.
 *      Anything else is dropped, never coerced into something identifying.
 *
 * What may NOT be a param is a content rule, not a type rule: no post id, user
 * id, handle, caption, coordinates, media URL or message text — ever. The
 * analytics test reads each hook site to keep that true.
 *
 * `window` is only touched inside functions so vitest (node, no document) can
 * import this module and unit-test the sanitiser.
 */

export type AnalyticsParamValue = string | number | boolean | null | undefined
export type AnalyticsParams = Record<string, AnalyticsParamValue>

export const ANALYTICS_NAME_PATTERN = /^[a-z][a-z0-9_]{0,39}$/
export const ANALYTICS_RESERVED_PREFIX = /^(firebase_|google_|ga_)/
export const ANALYTICS_MAX_PARAMS = 25
export const ANALYTICS_MAX_STRING_LENGTH = 100
/** GA4 caps user property VALUES at 36 characters (names share the event rule). */
export const ANALYTICS_MAX_USER_PROPERTY_LENGTH = 36

/** A valid GA4 event / param / user-property name, or null when it must be dropped. */
export function analyticsName(name: unknown): string | null {
  if (typeof name !== 'string') return null
  if (!ANALYTICS_NAME_PATTERN.test(name)) return null
  if (ANALYTICS_RESERVED_PREFIX.test(name)) return null
  return name
}

function analyticsValue(value: AnalyticsParamValue, maxLength: number): string | number | null {
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') return value.length > maxLength ? value.slice(0, maxLength) : value
  return null
}

/** Params shaped to the GA4 limits. Unknown keys, nested values, NaN, null and
 * undefined are dropped; the first 25 valid entries win. */
export function analyticsParams(params: AnalyticsParams | undefined): Record<string, string | number> {
  const shaped: Record<string, string | number> = {}
  if (!params) return shaped
  let count = 0
  for (const [rawKey, rawValue] of Object.entries(params)) {
    if (count >= ANALYTICS_MAX_PARAMS) break
    const key = analyticsName(rawKey)
    if (!key) continue
    const value = analyticsValue(rawValue, ANALYTICS_MAX_STRING_LENGTH)
    if (value === null) continue
    shaped[key] = value
    count += 1
  }
  return shaped
}

function isTopDocument(): boolean {
  try {
    return typeof window !== 'undefined' && window.parent === window
  } catch {
    // A cross-origin parent throws on access; that is still not the top.
    return false
  }
}

function debug(message: string, detail: unknown): void {
  if (!import.meta.env.DEV) return
  try { console.debug(`[analytics] ${message}`, detail) } catch { /* no console */ }
}

/**
 * Log one event through the native shell. Returns true only when a shell
 * accepted the bridge message; false in the browser preview, inside the map
 * iframe, or when the name failed validation.
 */
export function track(name: string, params?: AnalyticsParams): boolean {
  const eventName = analyticsName(name)
  if (!eventName) {
    debug('dropped event with an invalid name', name)
    return false
  }
  if (!isTopDocument()) return false
  const shaped = analyticsParams(params)
  if (!isNativeShell()) {
    debug(`no native shell, not sent: ${eventName}`, shaped)
    return false
  }
  return postNativeEvent({ type: 'analyticsEvent', name: eventName, params: shaped })
}

/**
 * Set (or with null, clear) one user-scoped property through the native shell.
 * Values are coerced like params but capped at GA4's 36-character limit.
 */
export function setAnalyticsUserProperty(name: string, value: AnalyticsParamValue): boolean {
  const propertyName = analyticsName(name)
  if (!propertyName) {
    debug('dropped user property with an invalid name', name)
    return false
  }
  if (!isTopDocument()) return false
  const shaped = value == null ? null : analyticsValue(value, ANALYTICS_MAX_USER_PROPERTY_LENGTH)
  const wire = shaped === null ? null : String(shaped)
  if (!isNativeShell()) {
    debug(`no native shell, not set: ${propertyName}`, wire)
    return false
  }
  return postNativeEvent({ type: 'analyticsUserProperty', name: propertyName, value: wire })
}

let initialized = false

/**
 * Called once from main.tsx. Publishes the `simulation` user property ('1'
 * while the workbench simulation is on, '0' otherwise) and keeps it current,
 * so test-mode sessions on a real device can be segmented out in GA. The map
 * iframe and the browser preview no-op here just like every other call.
 * Returns the teardown so a test can unsubscribe.
 */
export function initAnalytics(): () => void {
  if (initialized || !isTopDocument()) return () => {}
  initialized = true
  return () => {
    initialized = false
  }
}
