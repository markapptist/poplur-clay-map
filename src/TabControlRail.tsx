import type { ReactNode } from 'react'
import type { ControlSide } from './controlPlacement'
import styles from './TabControlRail.module.css'

export default function TabControlRail({
  side,
  label,
  children,
}: {
  side: ControlSide
  label: string
  children: ReactNode
}) {
  return (
    <div
      className={`${styles.rail} ${side === 'right' ? styles.right : styles.left}`}
      role="toolbar"
      aria-label={label}
      data-poplur-control-rail={side}
    >
      {children}
    </div>
  )
}
