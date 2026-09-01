import type { WeatherIconId } from './sideControlIcons'
import type { WeatherMode } from './WeatherFX'
import { SideControlIconImage } from './SideControlIcon'
import { approvedWeatherAssetId, weatherTextMark } from './weatherTextMark'
import styles from './ClayMap.module.css'

/**
 * Lightweight semantic weather mark shared by native-map Home chrome and Mapbox.
 * It deliberately lives outside ClayMap so importing the Home shell cannot
 * pull Mapbox and its complete controller graph into the initial entry chunk.
 * Fog is the sole approved tracked asset; other conditions stay text-only.
 */
export default function WeatherMark({
  mode,
  iconId,
  compact = false,
}: {
  mode: WeatherMode
  iconId?: WeatherIconId
  compact?: boolean
}) {
  const approvedAsset = approvedWeatherAssetId(mode, iconId)
  const label = weatherTextMark(mode, iconId)
  return (
    <span
      className={`${styles.weatherVisual}${compact ? ` ${styles.weatherVisualCompact}` : ''}${approvedAsset ? ` ${styles.weatherVisualProvidedAsset}` : ''}`}
      data-weather-text-mark={label}
      data-weather-provided-asset={approvedAsset ?? undefined}
      aria-hidden="true"
    >
      {approvedAsset ? (
        <SideControlIconImage
          icon={approvedAsset}
          displaySize={compact ? 42 : 44}
          className={styles.weatherProvidedAsset}
        />
      ) : (
        <span className={styles.weatherTextMark}>{label}</span>
      )}
    </span>
  )
}
