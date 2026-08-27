import React, { useCallback, useEffect, useRef, useState } from 'react'
import { isNativeShell, postNativeEvent } from './nativeBridge'
import { nextInAppBrowserOpenRequest, normalizeInAppBrowserURL } from './inAppBrowser'
import { playPop } from './pop'
import styles from './PoplurBrowserScreen.module.css'

export default function PoplurBrowserScreen({
  initialURL,
  bindBack,
}: {
  /** The HTTPS destination supplied by an ad or a source-credit tap. */
  initialURL?: string
  /** The persistent navigator cube steps back from a loaded page to start. */
  bindBack?: (fn: (() => boolean) | null) => void
} = {}) {
  const initial = normalizeInAppBrowserURL(initialURL) ?? null
  const [address, setAddress] = useState(initial ?? '')
  const [destination, setDestination] = useState<string | null>(initial)
  const [nativeOpenRequest, setNativeOpenRequest] = useState(0)
  const [error, setError] = useState('')
  const destinationRef = useRef(destination)
  destinationRef.current = destination

  // Home keeps this screen mounted while another Feed ad/source link can be
  // selected. Treat every new safe route as real browser navigation instead
  // of leaving the first destination frozen in useState's initial value.
  useEffect(() => {
    if (!initial) return
    setAddress(initial)
    setDestination(initial)
    setError('')
  }, [initial])

  const visit = useCallback((raw: string) => {
    const safe = normalizeInAppBrowserURL(raw)
    if (!safe) {
      setError('Enter a complete HTTPS address.')
      return
    }
    playPop()
    setAddress(safe)
    setDestination(safe)
    // React ignores a state write when the same address is submitted twice.
    // Keep an explicit request counter so GO and OPEN AGAIN still reopen the
    // isolated native browser after it has been dismissed.
    setNativeOpenRequest(nextInAppBrowserOpenRequest)
    setError('')
  }, [])

  // A native Poplur Browser is deliberately a separate, isolated controller:
  // the remote website stays in the app but cannot call the signed-in Poplur
  // bridge that hosts this screen. The Browser page remains underneath it, so
  // Done returns people to their Feed Browser session rather than to Safari.
  useEffect(() => {
    if (!destination || !isNativeShell()) return
    postNativeEvent({ type: 'openInAppBrowser', url: destination })
  }, [destination, nativeOpenRequest])

  useEffect(() => {
    if (!bindBack) return
    bindBack(() => {
      if (!destinationRef.current) return false
      setDestination(null)
      setError('')
      return true
    })
    return () => bindBack(null)
  }, [bindBack])

  let host = ''
  try { host = destination ? new URL(destination).hostname : '' } catch { /* guarded above */ }

  return (
    <section className={styles.screen} aria-label="Poplur Browser" data-clay-scroll>
      <div className={styles.shell}>
        <header className={styles.header}>
          <span className={styles.eyebrow}>FEED / BROWSER</span>
          <h1>Poplur Browser</h1>
          <p>Open HTTPS links without leaving Poplur.</p>
        </header>

        <form
          className={styles.addressBar}
          onSubmit={event => { event.preventDefault(); visit(address) }}
        >
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Website address"
            value={address}
            onChange={event => { setAddress(event.target.value); setError('') }}
            placeholder="https://example.com"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <button type="submit">GO</button>
        </form>
        {error && <p className={styles.error} role="alert">{error}</p>}

        {destination ? (
          <div className={styles.page}>
            <div className={styles.pageChrome}>
              {/* A cross-origin iframe cannot report its final URL after a
                  redirect or an in-page link. Do not show a lock or hostname
                  that could become stale and masquerade as browser chrome. */}
              <span>EXTERNAL PAGE · IN POPLUR</span>
              <button type="button" onClick={() => { playPop(); setDestination(null) }}>CLEAR</button>
            </div>
            {isNativeShell() ? (
              <div className={styles.nativePage} role="status">
                <span aria-hidden="true" className={styles.compass}>◉</span>
                <strong>OPEN IN POPLUR</strong>
                <p>{host} is open in Poplur’s private in-app browser.</p>
                <button type="button" onClick={() => visit(destination)}>OPEN AGAIN</button>
              </div>
            ) : (
              <iframe
                className={styles.frame}
                src={destination}
                title="Poplur Browser external page"
                sandbox="allow-forms allow-scripts allow-same-origin"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            )}
          </div>
        ) : (
          <div className={styles.start}>
            <span className={styles.compass} aria-hidden="true">◉</span>
            <strong>YOUR LINKS STAY IN POPLUR</strong>
            <p>Paste an HTTPS link, or tap an ad in Feed. The page opens here — never in a new tab.</p>
          </div>
        )}
      </div>
    </section>
  )
}
