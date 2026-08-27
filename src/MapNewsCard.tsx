import { useEffect, useRef } from 'react'
import type { LiveNewsEvent } from './liveNews'
import NewsPopCard from './NewsPopCard'
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
    <NewsPopCard
      status={status}
      statusKind={event.status}
      title={event.title}
      place={`${event.place}${event.country ? ` · ${event.country}` : ''}`}
      summary={event.summary}
      summaryLabel={event.preview ? 'PREVIEW SUMMARY' : 'SOURCE SUMMARY'}
      meta={`${event.sources.length} source${event.sources.length === 1 ? '' : 's'} · ${event.sources.map(source => source.publisher).join(' · ')}`}
      media={media ? {
        kind: media.kind === 'photo' ? 'image' : 'video',
        src: media.src,
        poster: media.kind === 'video' ? media.poster : undefined,
        alt: event.title,
        credit: media.credit,
      } : undefined}
      dataId={event.id}
      onClose={onDismiss}
      headerControls={(
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
      )}
      primaryAction={{ label: 'READ IN POPLUR NEWS', onActivate: onRead }}
    />
  )
}
