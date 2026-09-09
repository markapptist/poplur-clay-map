import { useEffect, useState } from 'react'
import type { SmartCard } from './tourSmarts'
import { normalizeInAppBrowserURL, openInPoplurBrowser } from './inAppBrowser'
import PoplurDialog, { type PoplurDialogPill } from './PoplurDialog'
import { playPop } from './pop'
import { productImage } from './productImage'
import { placeCreative, type PlaceCreative } from './placeCreative'
import { brandAccentFromImage } from './brandAccent'
import styles from './CommerceSuggestionWindow.module.css'

export interface SuggestionPrimaryAction {
  label: string
  onActivate: () => void
}

export interface CommerceSuggestionWindowProps {
  card: SmartCard
  action?: SuggestionPrimaryAction
  variant?: 'popup' | 'camera' | 'fullscreen'
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
  // The colour of the thing that was actually found. Read off the resolved
  // creative rather than a table of brands, so a shop nobody has heard of gets
  // its own card too. Null until it resolves, and null forever if the image is
  // cross-origin — the house pink is the fallback, never a wrong guess.
  const [accent, setAccent] = useState<string | null>(null)
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

  // Follow whatever image the card settled on, including the bundled poster —
  // that artwork is the advertiser's too.
  const creativeSrc = shot ?? (typeof card.media?.src === 'string' ? card.media.src : '')
  useEffect(() => {
    let live = true
    if (!creativeSrc) { setAccent(null); return }
    brandAccentFromImage(creativeSrc)
      .then(colour => { if (live) setAccent(colour) })
      .catch(() => { /* the house colour stands */ })
    return () => { live = false }
  }, [creativeSrc])

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
  // The house dialog, not the broadsheet window: the same pink clay frame,
  // dark panel and fact pills the map's pop card wears, so an ad on the Feed
  // reads as Poplur telling you something — one shape for every notice. The
  // sponsor, channel and offer rows become pills, the way the pop card carries
  // its radius and place.
  const pills: PoplurDialogPill[] = [
    // Disclosure, always, whatever colour the card is wearing.
    { icon: '🛍', text: 'Sponsored' },
    ...(card.channelTag ? [{ icon: '📺', text: card.channelTag }] : []),
    ...(card.rows?.slice(0, 3).map(row => ({ icon: '◆', text: `${row.label}: ${row.value}` })) ?? []),
  ]
  const summary = livePlace?.summary ?? card.line

  return (
    <PoplurDialog
      variant={variant === 'fullscreen' ? 'media' : 'card'}
      mediaBadge={variant === 'fullscreen' ? 'Sponsored · Poplur Ad' : undefined}
      dataId={`ad:${card.headline}`}
      accent={accent}
      // The eyebrow names WHAT WAS FOUND, not who is showing it to you. A
      // window that says POPLUR AD over a Best Buy shelf makes Poplur the
      // subject of its own discovery; the point of pointing the camera at
      // something is to be told about the something.
      //
      // The "Sponsored" disclosure does NOT go with it — it moves into the
      // pills below, where it stays visible. Dressing an ad in a brand's own
      // colours while dropping the word that says it is an ad would be a
      // different change entirely, and not one worth making.
      eyebrow={(card.sponsor ?? card.title ?? 'SPOTTED').toUpperCase()}
      title={card.headline}
      subtitle={(
        <>
          {summary}
          {livePlace && normalizeInAppBrowserURL(livePlace.sourceUrl) && (
            <>
              {' '}
              <button
                type="button"
                className={styles.newsSource}
                onClick={() => openBrowser(livePlace.sourceUrl)}
              >{livePlace.sourceLabel}</button>
            </>
          )}
        </>
      )}
      pills={pills}
      media={media}
      onMediaActivate={browserAction ?? runAppAction}
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
