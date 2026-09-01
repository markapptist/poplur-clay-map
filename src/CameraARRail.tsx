import { useEffect, useRef, useState } from 'react'
import TabControlRail from './TabControlRail'
import type { ControlSide } from './controlPlacement'
import { playPop } from './pop'
import { AR_FILTERS } from './ARFilters'
import {
  arFilterThumbnailUrl,
  loadARFilterCatalog,
  onARFilterCatalogChange,
} from './arFilterCatalog'
import styles from './CameraARRail.module.css'

/**
 * AR filters as the camera's second control rail, standing opposite the
 * camera's own controls and starting at the same top — one filter per button,
 * always on screen, in photo and video alike.
 *
 * It replaces the horizontal rail that a toggle used to open over the
 * viewfinder. That rail cost two taps before a filter could be seen at all and
 * covered the bottom of the shot while it was open; a filter is a thing you
 * pick WHILE framing, so it belongs beside the frame like every other camera
 * control rather than on top of it.
 *
 * Activation is on CLICK, deliberately, while the opposite rail's buttons fire
 * on pointerdown: this column scrolls, and a pointerdown activation would swap
 * the filter the instant you touched it to scroll past it.
 */
export default function CameraARRail({
  side,
  active,
  onPick,
}: {
  side: ControlSide
  active: string
  onPick: (id: string) => void
}) {
  const [, setCatalogRevision] = useState(0)
  const activeRef = useRef<HTMLButtonElement | null>(null)

  // The published catalog can carry more filters than the bundled fallback.
  // Fetched when the camera opens rather than at app start — the rail is
  // on screen from here on, so the fetch is answering something visible.
  useEffect(() => {
    let live = true
    const stop = onARFilterCatalogChange(() => { if (live) setCatalogRevision(n => n + 1) })
    void loadARFilterCatalog()
    return () => { live = false; stop() }
  }, [])

  // Keep the live filter visible in the column: the catalog is longer than the
  // screen, so a filter restored from a previous session (or picked with the
  // keyboard) can sit well outside the scrolled view.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <TabControlRail side={side} label="AR filters" scroll>
      {AR_FILTERS.map(filter => {
        const on = filter.id === active
        return (
          <button
            key={filter.id}
            ref={on ? activeRef : undefined}
            type="button"
            className={styles.filter}
            aria-pressed={on}
            aria-label={filter.label}
            title={filter.label}
            // The camera owns pinch and tap-to-focus on the surface beneath.
            // Without this, choosing a filter also refocuses the shot.
            onPointerDown={event => event.stopPropagation()}
            onClick={event => {
              event.stopPropagation()
              if (on) return
              playPop()
              onPick(filter.id)
            }}
          >
            {/* The thumbnail already carries this filter's authored grade and
                costume, so it is never re-filtered here — doing that doubles
                the look and puts a GPU effect on every visible button. */}
            <img
              className={styles.thumb}
              src={arFilterThumbnailUrl(filter.thumbnail)}
              alt=""
              aria-hidden="true"
              draggable={false}
              loading="lazy"
              decoding="async"
            />
          </button>
        )
      })}
    </TabControlRail>
  )
}
