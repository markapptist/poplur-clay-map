import type { KeyboardEvent, ReactNode } from 'react'
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
  onClose,
  dataId,
  ariaLabel,
}: {
  eyebrow?: string
  title: string
  subtitle?: ReactNode
  pills?: PoplurDialogPill[]
  media?: PoplurDialogMedia
  onMediaActivate?: () => void
  primaryAction?: PoplurDialogAction
  secondaryAction?: PoplurDialogAction
  onClose: () => void
  dataId?: string
  ariaLabel?: string
}) {
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()
  const activateMediaFromKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (!onMediaActivate || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onMediaActivate()
  }
  return (
    <section
      className={styles.host}
      data-poplur-dialog={dataId ?? ''}
      data-poplur-native-hit-region
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={stop}
    >
      <article
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? title}
      >
        <span className={styles.tab} aria-hidden="true">
          <img src="logo_icon.png" alt="" draggable={false} />
        </span>
        <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>×</button>
        <div className={styles.panel}>
          {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
          <h2 className={styles.title}>{title}</h2>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          {media && (
            <figure
              className={`${styles.media}${onMediaActivate ? ` ${styles.mediaInteractive}` : ''}`}
              role={onMediaActivate ? 'button' : undefined}
              tabIndex={onMediaActivate ? 0 : undefined}
              aria-label={onMediaActivate ? `Show ${title}` : undefined}
              onClick={onMediaActivate}
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
          {primaryAction && (
            <button type="button" className={styles.primary} onClick={primaryAction.onActivate}>
              {primaryAction.label} <span aria-hidden="true">→</span>
            </button>
          )}
          {secondaryAction && (
            <button type="button" className={styles.secondary} onClick={secondaryAction.onActivate}>
              {secondaryAction.label}
            </button>
          )}
        </div>
      </article>
    </section>
  )
}
