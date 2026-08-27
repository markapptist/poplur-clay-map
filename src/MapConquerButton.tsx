import SideControlIconButton from './SideControlIcon'
import styles from './MapConquerButton.module.css'

export default function MapConquerButton({
  open,
  onPress,
}: {
  open: boolean
  onPress: () => void
}) {
  return (
    <SideControlIconButton
      icon="map.conquer"
      className={styles.button}
      aria-label={open ? 'Hide Conquer standings' : 'Show Conquer standings'}
      aria-controls="poplur-conquer-glance"
      aria-expanded={open}
      data-map-conquer-toggle=""
      onActivate={onPress}
    />
  )
}
