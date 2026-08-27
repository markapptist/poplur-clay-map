import type { KeyboardEvent, ReactNode } from 'react'
import BoundedPopupVideo from './BoundedPopupVideo'
import styles from './MapNewsCard.module.css'

export interface NewsPopMedia {
  kind: 'image' | 'video'
  src: string
  poster?: string
  alt: string
  credit?: ReactNode
}

export interface NewsPopAction {
  label: string
  onActivate: () => void
}

export default function NewsPopCard({
  status,
  statusKind = 'pop',
  title,
  place,
  summary,
  summaryLabel,
  meta,
  media,
  onMediaActivate,
  headerControls,
  onClose,
  primaryAction,
  secondaryAction,
  embedded = false,
  dataId,
}: {
  status: string
  statusKind?: string
  title: string
  place?: string
  summary?: ReactNode
  summaryLabel?: string
  meta?: ReactNode
  media?: NewsPopMedia
  onMediaActivate?: () => void
  headerControls?: ReactNode
  onClose: () => void
  primaryAction?: NewsPopAction
  secondaryAction?: NewsPopAction
  embedded?: boolean
  dataId?: string
}) {
  const activateMediaFromKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (!onMediaActivate || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onMediaActivate()
  }

  return (
    <section
      className={embedded ? styles.embeddedHost : styles.host}
      aria-live="polite"
      data-news-pop={dataId ?? ''}
      data-poplur-native-hit-region
      onPointerDown={event => event.stopPropagation()}
      onPointerUp={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
    >
      <article
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-label={`${status}: ${title}`}
      >
        <header data-has-controls={headerControls ? 'true' : 'false'}>
          <span className={styles.status} data-status={statusKind}>{status}</span>
          {headerControls}
          <button type="button" className={styles.close} aria-label={`Close ${status.toLowerCase()}`} onClick={onClose}>×</button>
        </header>
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
            {media.credit && <figcaption>{media.credit}</figcaption>}
            {onMediaActivate && <span className={styles.mediaHint}>SHOW IN FEED <span aria-hidden="true">›</span></span>}
          </figure>
        )}
        <div className={styles.copy}>
          {place && <p className={styles.place}>{place}</p>}
          <h2>{title}</h2>
          {summary && (
            <p className={styles.summary}>
              {summaryLabel && <strong>{summaryLabel}</strong>}
              {summary}
            </p>
          )}
          {meta && <div className={styles.sources}>{meta}</div>}
          {(primaryAction || secondaryAction) && (
            <div className={styles.actions}>
              {primaryAction && (
                <button type="button" className={styles.read} onClick={primaryAction.onActivate}>
                  {primaryAction.label} <span aria-hidden="true">›</span>
                </button>
              )}
              {secondaryAction && (
                <button type="button" className={styles.secondary} onClick={secondaryAction.onActivate}>
                  {secondaryAction.label}
                </button>
              )}
            </div>
          )}
        </div>
      </article>
    </section>
  )
}
