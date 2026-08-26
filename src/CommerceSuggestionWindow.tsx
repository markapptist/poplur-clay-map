import React, { useEffect, useState } from 'react'
import type { SmartCard } from './tourSmarts'
import BoundedPopupVideo from './BoundedPopupVideo'
import { normalizeInAppBrowserURL, openInPoplurBrowser } from './inAppBrowser'
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

/**
 * One commerce surface for Map, Feed and Camera.
 *
 * The ad is deliberately a window, not a floating glass card: macOS traffic
 * lights make its behaviour legible, while the lower-third, channel bug and
 * starburst give it the loud shopping-TV sale energy requested for Poplur.
 * A deliberate link takes the person to Feed → Browser. Native shells then
 * present an isolated in-app browser, so an untrusted shop never receives
 * Poplur's signed-in WebView bridge.
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

  const safeLink = normalizeInAppBrowserURL(card.link?.url)

  const openBrowser = (candidate = safeLink) => {
    const destination = normalizeInAppBrowserURL(candidate)
    if (!destination) return
    playPop()
    onInteract?.()
    // First go to the dedicated Feed Browser screen. It owns the native
    // isolated controller, so this card never creates a tab or hands control
    // to the device browser.
    openInPoplurBrowser(destination)
    onClose()
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
    event.stopPropagation()
    const target = event.target
    if (target instanceof Element && target.closest('[data-ad-action]')) return
    playPop()
    onClose()
  }

  return (
    <section
      data-poplur-native-hit-region
      className={[styles.window, variant === 'camera' ? styles.camera : styles.popup].join(' ')}
      style={windowStyle}
      role="dialog"
      aria-label={card.headline}
      onPointerDown={event => event.stopPropagation()}
      onPointerUp={event => event.stopPropagation()}
      onClick={closeFromSurface}
    >
      <header className={styles.titleBar}>
        <div className={styles.traffic} aria-label="Window controls">
          <button type="button" className={`${styles.light} ${styles.close}`} aria-label="Close ad" onClick={() => { playPop(); onClose() }} />
          <button
            type="button"
            className={`${styles.light} ${styles.minimize}`}
            aria-label="Close ad"
            onClick={() => { playPop(); onClose() }}
          />
          <button
            type="button"
            className={`${styles.light} ${styles.zoom}`}
            aria-label="Close ad"
            onClick={() => { playPop(); onClose() }}
          />
        </div>
        <span className={styles.windowTitle}>{card.sponsor ?? 'Poplur Shopping Network'}</span>
        <span className={styles.secure}>AD</span>
      </header>

      <>
          <div className={styles.media}>
            {shot ? (
              /* Real product artwork wins over the bundled clip. A STILL, not a
                 video: this card sits over a live camera preview on a surface
                 already running ML, and a second decoder there is the exact
                 shape of regression the thermal gate exists to catch. */
              <img src={shot} alt={card.media?.alt ?? 'Product'} draggable={false} />
            ) : card.media?.kind === 'video' ? (
              <BoundedPopupVideo
                key={card.media.src}
                src={card.media.src}
                poster={card.media.poster}
                alt={card.media.alt}
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
            {livePlace && normalizeInAppBrowserURL(livePlace.sourceUrl) && (
              <button
                type="button"
                className={styles.liveSource}
                data-ad-action=""
                onClick={event => { event.stopPropagation(); openBrowser(livePlace.sourceUrl) }}
              >{livePlace.sourceLabel}</button>
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
                <button type="button" className={styles.shop} data-ad-action="" onClick={() => openBrowser()}>
                  {card.link?.label ?? 'SEE DEAL'}
                </button>
              )}
            </footer>
          )}
      </>
    </section>
  )
}
