import { useEffect, useState } from 'react'
import type { SmartCard } from './tourSmarts'
import { normalizeInAppBrowserURL, openInPoplurBrowser } from './inAppBrowser'
import NewsPopCard from './NewsPopCard'
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

  const media = shot
    ? { kind: 'image' as const, src: shot, alt: card.media?.alt ?? card.headline }
    // Camera already owns a live preview and ML pass. Keep its ad on the News
    // surface without starting a second decoder; the approved poster remains
    // the bounded visual fallback.
    : variant === 'camera' && card.media?.kind === 'video'
      ? card.media.poster
        ? { kind: 'image' as const, src: card.media.poster, alt: card.media.alt }
        : undefined
      : card.media
  const runAppAction = action ? () => {
    playPop()
    onInteract?.()
    action.onActivate()
    onClose()
  } : undefined
  const browserAction = safeLink ? () => openBrowser() : undefined
  const rows = card.rows?.slice(0, 3).map(row => `${row.label}: ${row.value}`).join(' · ')

  return (
    <NewsPopCard
      embedded
      status="POPLUR AD"
      statusKind="ad"
      place={card.sponsor ?? card.title}
      title={card.headline}
      summary={livePlace?.summary ?? card.line}
      summaryLabel="POPLUR PICK"
      meta={(
        <>
          {rows}
          {rows && livePlace && ' · '}
          {livePlace && normalizeInAppBrowserURL(livePlace.sourceUrl) && (
            <button
              type="button"
              className={styles.newsSource}
              onClick={() => openBrowser(livePlace.sourceUrl)}
            >{livePlace.sourceLabel}</button>
          )}
        </>
      )}
      media={media}
      onMediaActivate={browserAction}
      onClose={() => { playPop(); onClose() }}
      primaryAction={runAppAction ? { label: action?.label ?? 'OPEN', onActivate: runAppAction }
        : browserAction ? { label: card.link?.label ?? 'SEE DEAL', onActivate: browserAction }
          : undefined}
      secondaryAction={runAppAction && browserAction
        ? { label: card.link?.label ?? 'SEE DEAL', onActivate: browserAction }
        : undefined}
    />
  )
}
