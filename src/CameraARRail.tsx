import { useEffect, useState, type ReactNode } from 'react'
import ClayWheel from './ClayWheel'
import type { ControlSide } from './controlPlacement'
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
 * The column is a clay wheel, the same one the hold menu spins: the live
 * filter sits lit in the notch with its neighbours curving away above and
 * below, so you always see what comes before and after the one you are on.
 * A scrolling column of sixteen thumbnails either shrank them past reading or
 * hid the live one off-screen; the wheel keeps every visible tile large and
 * the lit one centred. The notch IS the pick — scrubbing applies each filter
 * as it arrives, the way the hold menu lights each tile.
 */
export default function CameraARRail({
  side,
  active,
  onPick,
  head,
}: {
  side: ControlSide
  active: string
  onPick: (id: string) => void
  /** Controls that stand at the TOP of this column, above the wheel — the
   *  camera's grid and timer. They are this column's because they are about
   *  the shot's composition, the way the filters are, and the other rail is
   *  already full. */
  head?: ReactNode
}) {
  const [, setCatalogRevision] = useState(0)

  // The published catalog can carry more filters than the bundled fallback.
  // Fetched when the camera opens rather than at app start — the rail is
  // on screen from here on, so the fetch is answering something visible.
  useEffect(() => {
    let live = true
    const stop = onARFilterCatalogChange(() => { if (live) setCatalogRevision(n => n + 1) })
    void loadARFilterCatalog()
    return () => { live = false; stop() }
  }, [])

  const items = AR_FILTERS.map(filter => ({
    id: filter.id,
    label: filter.label,
    // The thumbnail already carries this filter's authored grade and costume,
    // so it is never re-filtered here — doing that doubles the look and puts
    // a GPU effect on every visible tile.
    render: () => (
      <img
        className={styles.thumb}
        src={arFilterThumbnailUrl(filter.thumbnail)}
        alt=""
        aria-hidden="true"
        draggable={false}
        loading="lazy"
        decoding="async"
      />
    ),
  }))

  return (
    // Not inside the 44px control rail any more: nested there the wheel was
    // stacked under the rail's other controls and sat high on the screen. It
    // is its own column now, spanning the same band as the feed's channel
    // dial, so both wheels centre on the same line of the screen.
    <div
      className={`${styles.rail} ${side === 'right' ? styles.railRight : styles.railLeft}`}
      data-camera-ar-rail=""
    >
      {/* The camera owns pinch and tap-to-focus on the surface beneath. The
          wheel handles its own pointer first (bubbling), then this stops the
          gesture reaching the viewfinder so a scrub never refocuses the shot. */}
      {head && (
        <div
          className={styles.head}
          onPointerDown={event => event.stopPropagation()}
          onClick={event => event.stopPropagation()}
        >
          {head}
        </div>
      )}
      <div
        className={styles.wheelBox}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => event.stopPropagation()}
      >
        <ClayWheel
          items={items}
          selectedId={active}
          onSelect={id => { if (id !== active) onPick(id) }}
          ariaLabel="AR filters"
          side={side}
          tileSize={46}
          flipY
          showLabels
        />
      </div>
    </div>
  )
}
