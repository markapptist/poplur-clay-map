import React, { useEffect, useState } from 'react'
import type { SmartCard } from './tourSmarts'
import { isNativeShell, postNativeEvent } from './nativeBridge'
import { playPop } from './pop'
import { productImage } from './productImage'
import { placeCreative, type PlaceCreative } from './placeCreative'
import styles from './CommerceSuggestionWindow.module.css'

export interface SuggestionPrimaryAction {
  label: string
  onActivate: () => void
}

export interface CommerceSuggestionWindowProps {
  card: SmartCard
  action?: SuggestionPrimaryAction
  variant?: 'popup' | 'camera'
  onClose: () => void
  /** Stops a transient popup expiring after the user begins interacting. */
  onInteract?: () => void
}

function validatedHTTPS(raw: string | undefined): string | null {
  if (!raw || raw.length > 2_048) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password
      ? url.toString()
      : null
  } catch {
    return null
  }
}

function shortAddress(raw: string): string {
  try {
    const url = new URL(raw)
    return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`
  } catch {
    return raw
  }
}

/**
 * One commerce surface for Map, Feed and Camera.
 *
 * The ad is deliberately a window, not a floating glass card: macOS traffic
 * lights make its behaviour legible, while the lower-third, channel bug and
 * starburst give it the loud shopping-TV sale energy requested for Poplur.
 * Browser mode is the SAME window changing state. Native shells then present
 * an isolated in-app browser so an untrusted shop never receives Poplur's JS
 * bridge; the plain browser preview keeps the destination inside this window.
 */
export default function CommerceSuggestionWindow({
  card,
  action,
  variant = 'popup',
  onClose,
  onInteract,
}: CommerceSuggestionWindowProps) {
  // The ADVERTISER'S own picture, when the shell can fetch it. Until then the
  // bundled poster stands in, so the card never renders empty and never waits.
  // Keyed on the product URL: the same offer resolves once per device, ever.
  const productURL = card.link?.url ?? ''
  const [shot, setShot] = useState<string | null>(null)
  const [livePlace, setLivePlace] = useState<PlaceCreative | null>(null)
  useEffect(() => {
    let live = true
    setShot(null)
    setLivePlace(null)
    if (card.placeCreativeQuery) {
      placeCreative(card.placeCreativeQuery)
        .then(result => {
          if (!live || !result) return
          setLivePlace(result)
          setShot(result.image)
        })
        .catch(() => { /* keep the approved channel creative */ })
      return () => { live = false }
    }
    if (!productURL) return
    productImage(productURL)
      .then(src => { if (live) setShot(src) })
      .catch(() => { /* the bundled poster is the fallback */ })
    return () => { live = false }
  }, [card.placeCreativeQuery, productURL])

  const [browserURL, setBrowserURL] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [nativeOpening, setNativeOpening] = useState(false)
  const safeLink = validatedHTTPS(card.link?.url)
  const browserMode = browserURL !== null

  const openBrowser = () => {
    if (!safeLink) return
    playPop()
    onInteract?.()
    setBrowserURL(safeLink)
    if (!isNativeShell()) return
    setNativeOpening(true)
    // Let the alert visibly become a browser before the native sheet lands.
    window.setTimeout(() => {
      postNativeEvent({ type: 'openInAppBrowser', url: safeLink })
      setNativeOpening(false)
    }, 180)
  }

  const windowStyle = {
    '--ad-accent': card.accent ?? '#ff2d91',
    '--ad-accent-2': card.accent2 ?? '#67dcff',
  } as React.CSSProperties

  const closeFromSurface = (event: React.MouseEvent<HTMLElement>) => {
    // House rule for every ad: the ONLY press that does not dismiss is the
    // ad's own call to action. Everything else — the artwork, the headline,
    // the window chrome, the minimize and zoom lights — is a close target.
    //
    // This used to exempt `button, a, iframe` wholesale, which meant the
    // window controls quietly ate taps that were meant to get rid of the ad.
    // Actions now opt IN by carrying data-ad-action, so a control added later
    // dismisses by default rather than becoming another way to be stuck.
    //
    // Browser mode is the exception, and stays one: reaching it takes a
    // deliberate press on SEE DEAL, and a destination that closed itself on
    // the first tap inside it would be unusable.
    event.stopPropagation()
    const target = event.target
    if (browserMode && target instanceof Element && target.closest('button, a, iframe')) return
    if (target instanceof Element && target.closest('[data-ad-action]')) return
    playPop()
    onClose()
  }

  return (
    <section
      className={[
        styles.window,
        variant === 'camera' ? styles.camera : styles.popup,
        browserMode ? styles.browserMode : '',
        expanded ? styles.expanded : '',
        minimized ? styles.minimized : '',
      ].filter(Boolean).join(' ')}
      style={windowStyle}
      role="dialog"
      aria-label={browserMode ? `In-app browser for ${card.title}` : card.headline}
      onPointerDown={event => event.stopPropagation()}
      onPointerUp={event => event.stopPropagation()}
      onClick={closeFromSurface}
    >
      <header className={styles.titleBar}>
        <div className={styles.traffic} aria-label="Window controls">
          <button type="button" className={`${styles.light} ${styles.close}`} aria-label="Close ad" onClick={() => { playPop(); onClose() }} />
          {/* Outside browser mode these two are no longer window controls —
              they are close targets, like everything else that is not the CTA.
              Minimize/expand on a card that lives four seconds was ceremony;
              being able to get rid of it with whatever your thumb lands on is
              the point. They keep their real jobs inside the browser, which is
              the one place the window genuinely persists. */}
          <button
            type="button"
            className={`${styles.light} ${styles.minimize}`}
            aria-label={browserMode ? 'Back to ad' : 'Close ad'}
            {...(browserMode ? { 'data-ad-action': '' } : {})}
            onClick={() => {
              playPop()
              if (!browserMode) { onClose(); return }
              onInteract?.()
              setBrowserURL(null)
            }}
          />
          <button
            type="button"
            className={`${styles.light} ${styles.zoom}`}
            aria-label={browserMode ? (expanded ? 'Restore window size' : 'Expand window') : 'Close ad'}
            {...(browserMode ? { 'data-ad-action': '' } : {})}
            onClick={() => {
              playPop()
              if (!browserMode) { onClose(); return }
              onInteract?.()
              setMinimized(false)
              setExpanded(value => !value)
            }}
          />
        </div>
        <span className={styles.windowTitle}>
          {browserMode ? `Safari · ${shortAddress(browserURL)}` : (card.sponsor ?? 'Poplur Shopping Network')}
        </span>
        <span className={styles.secure}>{browserMode ? '🔒' : 'AD'}</span>
      </header>

      {minimized ? null : browserMode ? (
        <div className={styles.browser}>
          <div className={styles.addressBar}>
            <button type="button" onClick={() => { playPop(); setBrowserURL(null) }} aria-label="Back to ad">‹</button>
            <span>🔒 {shortAddress(browserURL)}</span>
            <button type="button" onClick={() => { playPop(); setExpanded(value => !value) }} aria-label="Resize browser">↗</button>
          </div>
          {isNativeShell() ? (
            <div className={styles.nativeBrowserState} role="status">
              <span className={styles.browserCompass} aria-hidden="true">◉</span>
              <strong>{nativeOpening ? 'OPENING IN POPLUR…' : 'IN-APP BROWSER OPEN'}</strong>
              <small>The secure page stays inside the app.</small>
              <button type="button" onClick={openBrowser}>OPEN AGAIN</button>
            </div>
          ) : (
            <iframe
              className={styles.browserFrame}
              src={browserURL}
              title={`${card.title} shopping page`}
              sandbox="allow-forms allow-scripts allow-same-origin"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          )}
        </div>
      ) : (
        <>
          <div className={styles.media}>
            {shot ? (
              /* Real product artwork wins over the bundled clip. A STILL, not a
                 video: this card sits over a live camera preview on a surface
                 already running ML, and a second decoder there is the exact
                 shape of regression the thermal gate exists to catch. */
              <img src={shot} alt={card.media?.alt ?? 'Product'} draggable={false} />
            ) : card.media?.kind === 'video' ? (
              <video
                src={card.media.src}
                poster={card.media.poster}
                aria-label={card.media.alt}
                autoPlay
                muted
                loop
                playsInline
                disablePictureInPicture
              />
            ) : card.media ? (
              <img src={card.media.src} alt={card.media.alt} draggable={false} />
            ) : (
              <div className={styles.noMedia} aria-hidden="true"><span>POPLUR</span><b>SHOP TV</b></div>
            )}
            <span className={styles.mediaShade} aria-hidden="true" />
            <span className={styles.channelTag}>{card.channelTag ?? 'POPLUR SHOP TV · LIVE'}</span>
            <span className={styles.sponsorTag}>{card.sponsor ?? card.title}</span>
            <span className={styles.burst} aria-label={card.badge ?? 'Hot deal'}>{card.badge ?? 'KAPOW!'}</span>
            {/* Attribution for the place creative — kept live under the
                close-on-any-press rule because it is the source credit the
                data is used under, not ad furniture. */}
            {livePlace && (
              <a
                className={styles.liveSource}
                href={livePlace.sourceUrl}
                target="_blank"
                rel="noreferrer"
                data-ad-action=""
                onClick={event => event.stopPropagation()}
              >{livePlace.sourceLabel}</a>
            )}
          </div>

          <div className={styles.lowerThird}>
            <span className={styles.kicker}>POPLUR AI PICKS · {card.title}</span>
            <strong className={styles.headline}>{card.headline}</strong>
            {livePlace?.summary && <span className={styles.liveSummary}>{livePlace.summary}</span>}
            {card.rows && card.rows.length > 0 && (
              <span className={styles.rows}>
                {card.rows.slice(0, 3).map(row => (
                  <span className={styles.row} key={`${row.label}:${row.value}`}>
                    <span>{row.label}</span><b>{row.value}</b>
                  </span>
                ))}
              </span>
            )}
          </div>

          {(action || safeLink) && (
            <footer className={styles.actions}>
              {action && (
                <button
                  type="button"
                  className={styles.primary}
                  data-ad-action=""
                  onClick={() => {
                    playPop()
                    onInteract?.()
                    action.onActivate()
                    onClose()
                  }}
                >
                  {action.label}
                </button>
              )}
              {safeLink && (
                <button type="button" className={styles.shop} data-ad-action="" onClick={openBrowser}>
                  {card.link?.label ?? 'SEE DEAL'}
                </button>
              )}
            </footer>
          )}
        </>
      )}
    </section>
  )
}
