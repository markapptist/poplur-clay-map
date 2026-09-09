import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import BoundedPopupVideo from './BoundedPopupVideo'
import styles from './PoplurDialog.module.css'

// The house dialog. One shape for every "Poplur is telling you something"
// moment — a pop opened from the map, a radius moving, a weather update —
// built on the reviewed design sheet: pink clay frame, dark panel, the P tab
// on the top edge, fact pills, one pink button. The map's pop card is the
// first surface on it; News keeps its own broadsheet card.

export interface PoplurDialogAction {
  label: string
  onActivate: () => void
}

export interface PoplurDialogPill {
  icon: ReactNode
  text: string
  tone?: 'plain' | 'up'
}

export interface PoplurDialogMedia {
  kind: 'image' | 'video'
  src: string
  poster?: string
  alt: string
}

export default function PoplurDialog({
  eyebrow,
  title,
  subtitle,
  pills,
  media,
  onMediaActivate,
  primaryAction,
  secondaryAction,
  tertiaryAction,
  onClose,
  dataId,
  ariaLabel,
  variant = 'card',
  mediaBadge,
  accent,
}: {
  eyebrow?: string
  title: string
  subtitle?: ReactNode
  pills?: PoplurDialogPill[]
  media?: PoplurDialogMedia
  onMediaActivate?: () => void
  primaryAction?: PoplurDialogAction
  secondaryAction?: PoplurDialogAction
  /** A second quiet action beside `secondaryAction` — the pop card carries
   *  both "view their profile" and "DM them", and neither outranks the
   *  primary media action. */
  tertiaryAction?: PoplurDialogAction
  onClose: () => void
  dataId?: string
  ariaLabel?: string
  /** Wear something else's colour instead of the house pink. The camera's scan
   *  cards pass the colour of the thing they actually recognised, so the window
   *  arrives looking like that rather than like Poplur. */
  accent?: string | null
  /**
   * 'card' is the Poplur dialog everything else uses: the clay tab, the big
   * title, the pills. 'media' is the map's pop window — the content itself and
   * the two ways to act on it, with no frame, no logo and no heading. A pop
   * you tapped on the map is already identified by the card under the title;
   * repeating it in a blocky frame around the picture was the thing in the way
   * (user-ordered 6 Sep). The title still ships, for screen readers.
   */
  variant?: 'card' | 'media'
  mediaBadge?: string
}) {
  const mediaFirst = variant === 'media'
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()
  // With no × and nothing around the window to tap, the pop itself is the way
  // out. PopupHost's tap-anywhere dismissal explicitly skips anything inside
  // the popup host, and this window now IS the whole screen — so without this
  // the only exits would be the two actions and the 10s expiry.
  const dismissFromBackdrop = (event: { stopPropagation: () => void }) => {
    event.stopPropagation()
    onClose()
  }
  const activateMediaFromKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (!onMediaActivate || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onMediaActivate()
  }
  // Fullscreen, the picture is not a button: tapping it closes the window.
  // "See in Feed" sits ON the pop now and carries that action, so nothing is
  // lost by taking it off the media itself — and a full-screen tap target that
  // navigates would leave no way to simply back out.
  const mediaActivatable = !mediaFirst && !!onMediaActivate
  const actions = (
    <>
      {primaryAction && (
        <button type="button" className={styles.primary} onClick={primaryAction.onActivate}>
          {primaryAction.label} <span aria-hidden="true">→</span>
        </button>
      )}
      {/* The DM action reads as a REAL button, the same weight as the
          primary: writing to a person is a destination, not fine print. */}
      {tertiaryAction && (
        <button type="button" className={styles.primary} onClick={tertiaryAction.onActivate}>
          {tertiaryAction.label} <span aria-hidden="true">→</span>
        </button>
      )}
      {secondaryAction && (
        <button type="button" className={styles.secondary} onClick={secondaryAction.onActivate}>
          {secondaryAction.label}
        </button>
      )}
    </>
  )
  const hasActions = !!(primaryAction || tertiaryAction || secondaryAction)
  return (
    <section
      className={mediaFirst ? `${styles.host} ${styles.hostMedia}` : styles.host}
      data-poplur-dialog={dataId ?? ''}
      data-poplur-native-hit-region
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={mediaFirst ? dismissFromBackdrop : stop}
    >
      <article
        className={mediaFirst ? `${styles.dialog} ${styles.dialogMedia}` : styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? title}
        style={accent ? ({ '--dialogAccent': accent } as CSSProperties) : undefined}
      >
        {!mediaFirst && (
          <span className={styles.tab} aria-hidden="true">
            <img src="logo_icon.png" alt="" draggable={false} />
          </span>
        )}
        {/* The fullscreen pop window carries no × (user-ordered 6 Sep): it is
            the pop, edge to edge, and a chrome button in the corner is the
            frame all over again. A tap on the pop itself closes it — see
            `dismissFromBackdrop`. */}
        {!mediaFirst && (
          <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>×</button>
        )}
        <div className={mediaFirst ? `${styles.panel} ${styles.panelMedia}` : styles.panel}>
          {mediaFirst && mediaBadge && <p className={styles.mediaBadge}>{mediaBadge}</p>}
          {eyebrow && !mediaFirst && <p className={styles.eyebrow}>{eyebrow}</p>}
          {mediaFirst
            ? <h2 className={styles.srOnly}>{title}</h2>
            : <h2 className={styles.title}>{title}</h2>}
          {subtitle && !mediaFirst && <p className={styles.subtitle}>{subtitle}</p>}
          {media && (
            <figure
              className={`${styles.media}${mediaActivatable ? ` ${styles.mediaInteractive}` : ''}`}
              role={mediaActivatable ? 'button' : undefined}
              tabIndex={mediaActivatable ? 0 : undefined}
              aria-label={mediaActivatable ? `Show ${title}` : undefined}
              onClick={mediaActivatable ? onMediaActivate : undefined}
              onKeyDown={activateMediaFromKeyboard}
            >
              {media.kind === 'video' ? (
                <BoundedPopupVideo
                  key={media.src}
                  src={media.src}
                  poster={media.poster}
                  alt={media.alt}
                  disablePictureInPicture
                />
              ) : (
                <img src={media.src} alt={media.alt} draggable={false} />
              )}
              {mediaFirst && hasActions && (
                // Inside the content, not under it: a scrim at the foot of the
                // pop with the actions on top. `stop` keeps a button press from
                // also reaching the close-on-tap handler on the way out.
                <div className={styles.mediaActions} onClick={stop}>
                  {actions}
                </div>
              )}
            </figure>
          )}
          {pills && pills.length > 0 && (
            <div className={styles.pillRow}>
              {pills.map((pill, index) => (
                <span key={index} className={`${styles.pill}${pill.tone === 'up' ? ` ${styles.pillUp}` : ''}`}>
                  <em aria-hidden="true">{pill.icon}</em>
                  {pill.text}
                </span>
              ))}
            </div>
          )}
          {!mediaFirst && actions}
        </div>
      </article>
    </section>
  )
}
