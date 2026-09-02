import type { CSSProperties, ReactNode } from 'react'
import type { ControlSide } from './controlPlacement'
import styles from './TabControlRail.module.css'

export default function TabControlRail({
  side,
  label,
  scroll = false,
  fill = false,
  fillReserveBelow,
  children,
}: {
  side: ControlSide
  label: string
  /** Let the rail scroll when it carries more controls than the screen fits.
   *  A screen's own controls are a short fixed set and never need this; the
   *  camera's AR filters are a published catalog that can outgrow the column. */
  scroll?: boolean
  /** Divide the room between the rail's top and the home chrome among these
   *  controls, instead of stacking them at a fixed 44px. For a rail that is
   *  half of a PAIR of columns and has to reach the same bottom line as its
   *  partner — the feed's. A screen whose rail is a short list of its own
   *  controls should stay 44px; growing those to fill a tall screen would make
   *  a handful of buttons enormous. */
  fill?: boolean
  /** With `fill`, the room to leave BELOW this rail for whatever else shares
   *  its column (the feed's channel stepper sits under its action rail). */
  fillReserveBelow?: string
  children: ReactNode
}) {
  return (
    <div
      className={`${styles.rail} ${side === 'right' ? styles.right : styles.left}${scroll ? ` ${styles.scroll}` : ''}${fill ? ` ${styles.fill}` : ''}`}
      style={fill && fillReserveBelow
        ? ({ '--rail-reserve-below': fillReserveBelow } as CSSProperties)
        : undefined}
      role="toolbar"
      aria-label={label}
      data-poplur-control-rail={side}
    >
      {children}
    </div>
  )
}
