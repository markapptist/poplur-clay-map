import { useEffect, useRef } from 'react'
import PoplurDialog from './PoplurDialog'
import styles from './MapUnavailable.module.css'

export default function MapUnavailable({ onRetry, onLeave }: {
  onRetry: () => void
  onLeave: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const dialog = host.current?.querySelector<HTMLElement>('[role="dialog"]')
    if (dialog) { dialog.tabIndex = -1; dialog.focus() }
  }, [])
  return <div ref={host} className={styles.host}>
    <PoplurDialog
      dataId="map-unavailable"
      title="Let’s try the map again"
      subtitle="The map couldn’t connect. Check your connection, then give it another try."
      primaryAction={{ label: 'Try again', onActivate: onRetry }}
      secondaryAction={{ label: 'Open feed', onActivate: onLeave }}
      onClose={onLeave}
    />
  </div>
}
