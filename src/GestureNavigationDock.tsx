import { useRef, type HTMLAttributes } from 'react'
import { swipeNavigationAction, type SwipeAction } from './gestureNavigation'
import styles from './ClayArrowCluster.module.css'

export default function GestureNavigationDock({ onAction, label, hints, className, ...rest }: Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> & {
  onAction: (direction: SwipeAction) => void
  label?: string
  hints: { up: string; down: string; left: string; right: string }
}) {
  const start = useRef<{ id: number; x: number; y: number } | null>(null)
  return <div {...rest} role="group" tabIndex={0}
    className={`${styles.cluster} ${styles.gestureDock} ${className ?? ''}`}
    aria-label={`Swipe controls. Up: ${hints.up}. Down: ${hints.down}. Swipe left: ${hints.right}. Swipe right: ${hints.left}.`}
    data-poplur-gesture-navigation=""
    onKeyDown={event => {
      const direction = ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } as const)[event.key as 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight']
      if (direction) { event.preventDefault(); event.stopPropagation(); onAction(direction) }
    }}
    onPointerDown={event => {
      event.stopPropagation()
      if (!event.isPrimary) { start.current = null; return }
      start.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
      try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Older WebViews retain local swipes. */ }
    }}
    onPointerMove={event => event.stopPropagation()}
    onPointerCancel={event => { event.stopPropagation(); start.current = null }}
    onPointerUp={event => {
      event.stopPropagation()
      const origin = start.current; start.current = null
      if (!origin || origin.id !== event.pointerId) return
      const action = swipeNavigationAction(event.clientX - origin.x, event.clientY - origin.y)
      if (action) onAction(action)
    }}
    onClick={event => event.stopPropagation()}>
    <span>{label}</span>
  </div>
}
