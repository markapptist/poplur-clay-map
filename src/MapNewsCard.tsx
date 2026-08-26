import { useEffect, useRef } from 'react'
import BoundedPopupVideo from './BoundedPopupVideo'
import type { LiveNewsEvent } from './liveNews'
import styles from './MapNewsCard.module.css'

export default function MapNewsCard({
  event,
  stop,
  total,
  onDismiss,
  focusDirection,
  onNavigationFocusRestored,
  onPrevious,
  onNext,
  onRead,
}: {
  event: LiveNewsEvent
  stop: number
  total: number
  onDismiss: () => void
  focusDirection: 'previous' | 'next' | null
  onNavigationFocusRestored: () => void
  onPrevious: (restoreFocus: boolean) => void
  onNext: (restoreFocus: boolean) => void
  onRead: () => void
}) {
  const media = event.media[0]
  const status = event.preview ? 'TOUR PREVIEW' : event.status.toUpperCase()
  const previousRef = useRef<HTMLButtonElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const canStep = total > 1

  // A keyboard step deliberately removes this card during the bounded camera
  // flight. Restore focus to the matching control when the next card arrives;
  // pointer users keep normal focus behaviour.
  useEffect(() => {
    if (!canStep || !focusDirection) return
    const control = focusDirection === 'previous' ? previousRef.current : nextRef.current
    control?.focus({ preventScroll: true })
    onNavigationFocusRestored()
  }, [canStep, focusDirection, onNavigationFocusRestored])

  return (
    <section className={styles.host} aria-live="polite" data-map-news-card={event.id}>
      <article className={styles.card} role="dialog" aria-label={`${status}: ${event.title}`}>
        <header>
          <span className={styles.status} data-status={event.status}>{status}</span>
          <nav className={styles.tourNav} aria-label="News tour controls">
            <button
              ref={previousRef}
              type="button"
              aria-label="Previous news story"
              disabled={!canStep}
              onClick={click => onPrevious(click.detail === 0)}
            >‹</button>
            <span className={styles.position}>{stop} / {total}</span>
            <button
              ref={nextRef}
              type="button"
              aria-label="Next news story"
              disabled={!canStep}
              onClick={click => onNext(click.detail === 0)}
            >›</button>
          </nav>
          <button type="button" className={styles.close} aria-label="Close news story" onClick={onDismiss}>×</button>
        </header>
        {media && (
          <figure className={styles.media}>
            {media.kind === 'video' ? (
              <BoundedPopupVideo src={media.src} poster={media.poster} alt={event.title} disablePictureInPicture />
            ) : (
              <img src={media.src} alt="" draggable={false} />
            )}
            <figcaption>{media.credit}</figcaption>
          </figure>
        )}
        <div className={styles.copy}>
          <p className={styles.place}>{event.place}{event.country ? ` · ${event.country}` : ''}</p>
          <h2>{event.title}</h2>
          <p className={styles.summary}><strong>{event.preview ? 'PREVIEW SUMMARY' : 'SOURCE SUMMARY'}</strong> {event.summary}</p>
          <p className={styles.sources}>
            {event.sources.length} source{event.sources.length === 1 ? '' : 's'} · {event.sources.map(source => source.publisher).join(' · ')}
          </p>
          <button type="button" className={styles.read} onClick={onRead}>READ IN POPLUR NEWS <span aria-hidden="true">›</span></button>
        </div>
      </article>
    </section>
  )
}
