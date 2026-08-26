import styles from './MapNewsButton.module.css'

export default function MapNewsButton({
  active,
  loading = false,
  count = 0,
  onPress,
}: {
  active: boolean
  loading?: boolean
  count?: number
  onPress: () => void
}) {
  const label = active ? 'Stop the worldwide news tour' : 'Tour live news around the world'
  return (
    <button
      type="button"
      className={styles.button}
      aria-label={label}
      aria-pressed={active}
      aria-busy={loading}
      data-map-news-button=""
      onClick={onPress}
    >
      <img src="/holdmenu/News.png" alt="" draggable={false} />
      {loading ? (
        <span className={styles.pulse} aria-hidden="true" />
      ) : count > 0 ? (
        <span className={styles.count} aria-hidden="true">{Math.min(count, 99)}</span>
      ) : null}
    </button>
  )
}
