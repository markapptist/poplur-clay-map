import styles from './MapRewardRollButton.module.css'
import { RADIUS_REWARD_DICE_SPRITE } from './radiusRewardNavigator'

export default function MapRewardRollButton({
  active,
  onPress,
}: {
  active: boolean
  onPress: () => void
}) {
  return (
    <button
      className={styles.button}
      type="button"
      aria-label={active ? 'View today\u2019s free Map reward roll' : 'Open free Map reward roll'}
      data-active={active ? 'true' : 'false'}
      data-map-reward-roll-button=""
      onClick={onPress}
    >
      <img
        src={`${import.meta.env.BASE_URL}${RADIUS_REWARD_DICE_SPRITE}`}
        alt=""
        aria-hidden="true"
      />
    </button>
  )
}
