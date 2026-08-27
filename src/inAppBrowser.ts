/**
 * Poplur never hands an advertised destination to a new tab.  Destinations
 * first pass this narrow boundary, then Home routes them to Feed → Browser.
 * Native Browser owns the actual external document so untrusted pages never
 * inherit Poplur's WebView bridge.
 */
export const POPLUR_OPEN_FEED_BROWSER_EVENT = 'poplur-open-feed-browser'

/**
 * Native browsing is an action, not just a selected URL. React deliberately
 * ignores a state write whose value is unchanged, so a monotonically
 * increasing request id lets OPEN AGAIN relaunch the same HTTPS address after
 * the private browser was dismissed.
 */
export function nextInAppBrowserOpenRequest(current: number): number {
  return current + 1
}

export function normalizeInAppBrowserURL(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value || value.length > 2_048) return null
  try {
    // Typing example.com is the natural address-bar interaction.  Schemed
    // inputs remain exact, so http:, file:, javascript:, and data: all fail
    // the HTTPS-only test below rather than being silently rewritten.
    const url = new URL(value.includes('://') ? value : `https://${value}`)
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}

/** Ask the shell to move to its Feed Browser page with a safe destination. */
export function openInPoplurBrowser(raw: unknown): string | null {
  const url = normalizeInAppBrowserURL(raw)
  if (!url || typeof window === 'undefined') return null
  window.dispatchEvent(new CustomEvent(POPLUR_OPEN_FEED_BROWSER_EVENT, { detail: { url } }))
  return url
}
