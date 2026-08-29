import { SideControlIconImage } from './SideControlIcon'
import { SIDE_CONTROL_ICONS } from './sideControlIcons'
import { playPop } from './pop'
import { channelControlImageSize } from './channelControlSizing'
import styles from './PoplurChannelRail.module.css'

/** Static artwork for the one persistent global channel rail. */
export default function PoplurChannelRail({
  number,
  label,
  onUp,
  onDown,
  upLabel = SIDE_CONTROL_ICONS['global.channel_up'].accessibilityLabel,
  downLabel = SIDE_CONTROL_ICONS['global.channel_down'].accessibilityLabel,
  size = 176,
}: {
  number: number
  label?: string
  onUp: () => void
  onDown: () => void
  upLabel?: string
  downLabel?: string
  size?: number
}) {
  const width = Math.round(size / 2)
  const imageSize = channelControlImageSize(size)
  const activate = (handler: () => void) => {
    playPop()
    handler()
  }

  return (
    <div
      className={styles.rail}
      style={{ width, height: size }}
      data-poplur-global-channel-rail=""
    >
      <span
        aria-hidden="true"
        data-poplur-channel-renderer="ready"
        style={{ position: 'absolute', inset: 0, display: 'block', pointerEvents: 'none' }}
      />
      <button
        type="button"
        className={`${styles.button} ${styles.up}`}
        data-poplur-channel-control="up"
        data-side-control-id="global.channel_up"
        aria-label={upLabel}
        onClick={() => activate(onUp)}
      >
        <SideControlIconImage icon="global.channel_up" displaySize={imageSize} loading="eager" />
      </button>

      <span className={styles.number}>
        {label ?? number}
      </span>

      <button
        type="button"
        className={`${styles.button} ${styles.down}`}
        data-poplur-channel-control="down"
        data-side-control-id="global.channel_down"
        aria-label={downLabel}
        onClick={() => activate(onDown)}
      >
        <SideControlIconImage icon="global.channel_down" displaySize={imageSize} loading="eager" />
      </button>
    </div>
  )
}
