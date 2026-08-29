import { SideControlIconImage } from './SideControlIcon'
import { weatherIconIdForMode } from './sideControlIcons'
import type { WeatherMode } from './WeatherFX'
import styles from './ClayMap.module.css'

/**
 * Lightweight weather artwork shared by native-map Home chrome and Mapbox.
 * It deliberately lives outside ClayMap so importing the Home shell cannot
 * pull Mapbox and its complete controller graph into the initial entry chunk.
 */
export default function WeatherMark({
  mode,
  icon: _icon,
  cloud: _cloud,
  compact = false,
}: {
  mode: WeatherMode
  icon: string
  cloud?: string | null
  compact?: boolean
}) {
  return (
    <span className={`${styles.weatherVisual}${compact ? ` ${styles.weatherVisualCompact}` : ''}`}>
      <SideControlIconImage
        icon={weatherIconIdForMode(mode)}
        displaySize={compact ? 42 : 44}
        className={styles.weatherStaticImage}
      />
    </span>
  )
}
