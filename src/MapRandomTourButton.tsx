import styles from './MapRewardRollButton.module.css'
import { RADIUS_REWARD_DICE_SPRITE } from './radiusRewardNavigator'

/**
 * The normal Map rail's dice is discovery, not the preview-only daily reward.
 * It reuses the approved baked Poplur die artwork while keeping the two
 * controls' actions and accessible names distinct.
 */
export default function MapRandomTourButton({ onPress }: { onPress: () => void }) {
  return (
    <button
      className={styles.button}
      type="button"
      aria-label="Tour four random landmarks"
      data-map-random-tour-button=""
      onPointerDown={event => {
        if (event.isPrimary && event.button === 0) onPress()
      }}
      onClick={event => {
        if (event.detail === 0) onPress()
      }}
    >
      <img
        src={`${import.meta.env.BASE_URL}${RADIUS_REWARD_DICE_SPRITE}`}
        alt=""
        aria-hidden="true"
      />
    </button>
  )
}
