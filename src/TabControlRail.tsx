import type { ReactNode } from 'react'
import type { ControlSide } from './controlPlacement'
import styles from './TabControlRail.module.css'

export default function TabControlRail({
  side,
  label,
  scroll = false,
  children,
}: {
  side: ControlSide
  label: string
  /** Let the rail scroll when it carries more controls than the screen fits.
   *  A screen's own controls are a short fixed set and never need this; the
   *  camera's AR filters are a published catalog that can outgrow the column. */
  scroll?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={`${styles.rail} ${side === 'right' ? styles.right : styles.left}${scroll ? ` ${styles.scroll}` : ''}`}
      role="toolbar"
      aria-label={label}
      data-poplur-control-rail={side}
    >
      {children}
    </div>
  )
}
