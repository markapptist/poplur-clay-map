import SideControlIconButton from './SideControlIcon'
import styles from './MapNewsButton.module.css'

export default function MapNewsButton({
  active,
  loading = false,
  count = 0,
  destination = 'tour',
  onPress,
}: {
  active: boolean
  loading?: boolean
  count?: number
  destination?: 'tour' | 'edition'
  onPress: () => void
}) {
  const label = destination === 'edition'
    ? 'Open Poplur News edition'
    : active
      ? 'Stop the worldwide news tour'
      : 'Tour live news around the world'
  return (
    <SideControlIconButton
      icon="map.news"
      className={styles.button}
      aria-label={label}
      aria-pressed={active}
      loading={loading}
      data-map-news-button=""
      activation="pointerdown"
      onActivate={onPress}
      overlay={!loading && count > 0 ? (
        <span className={styles.count} aria-hidden="true">{Math.min(count, 99)}</span>
      ) : null}
    />
  )
}
