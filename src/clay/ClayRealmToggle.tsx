import React, { useState } from 'react'
import type {
  ClayMapSettings,
  ClayQualityPreset,
} from './clayMapConfig'
import type { ClayDebugState } from './ClayMapController'
import styles from '../ClayMap.module.css'

// The clay coat is not a mode — it IS the Poplur signature map (photoreal
// geography fused with the clay treatment). This component is now only the
// dev-time TUNE panel for dialling the coat; it renders nothing in production.

interface Props {
  settings: ClayMapSettings
  quality: ClayQualityPreset
  debug: ClayDebugState | null
  dev: boolean
  onSettingsChange: (settings: ClayMapSettings) => void
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

export default function ClayRealmToggle({
  settings,
  quality,
  debug,
  dev,
  onSettingsChange,
}: Props) {
  const [open, setOpen] = useState(false)
  const patch = (next: Partial<ClayMapSettings>) => onSettingsChange({ ...settings, ...next })

  if (!dev) return null

  return (
    <div className={styles.clayModeDock}>
      <div className={styles.clayModePill} role="group" aria-label="Clay coat tuning">
        <button
          type="button"
          className={open ? styles.clayTuneButtonActive : styles.clayTuneButton}
          aria-expanded={open}
          aria-controls="clay-realm-settings"
          onClick={() => setOpen(v => !v)}
        >
          TUNE
        </button>
      </div>

      {open && (
        <div id="clay-realm-settings" className={styles.claySettingsPanel}>
          <label className={styles.claySettingRow}>
            <span>Clay intensity</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={settings.clayStrength}
              onChange={event => patch({ clayStrength: clamp01(Number(event.target.value)) })}
            />
          </label>
          <label className={styles.claySettingRow}>
            <span>Texture detail</span>
            <input
              type="range"
              min="0.08"
              max="0.65"
              step="0.01"
              value={settings.textureDetail}
              onChange={event => patch({ textureDetail: clamp01(Number(event.target.value)) })}
            />
          </label>
          <label className={styles.claySettingRow}>
            <span>Clay grain</span>
            <input
              type="range"
              min="0"
              max="0.08"
              step="0.002"
              value={settings.grainStrength}
              onChange={event => patch({ grainStrength: Math.max(0, Number(event.target.value)) })}
            />
          </label>
          <label className={styles.clayCheckRow}>
            <input
              type="checkbox"
              checked={settings.enableDepthOfField}
              onChange={event => patch({ enableDepthOfField: event.target.checked })}
            />
            <span>Miniature depth effect</span>
          </label>
          <label className={styles.clayCheckRow}>
            <input
              type="checkbox"
              checked={settings.enableLandmarkReplacement}
              onChange={event => patch({ enableLandmarkReplacement: event.target.checked })}
            />
            <span>Landmark replacements</span>
          </label>
          <div className={styles.clayQualityLine}>Quality preset: {quality}</div>

          {dev && debug && (
            <div className={styles.clayDebugPanel} aria-label="Clay Realm debug">
              <span>Mode: {debug.mode}</span>
              <span>FPS: {debug.fps}</span>
              <span>Models: {debug.modelCount}</span>
              <span>Post: {debug.postProcessingEnabled ? 'on' : 'off'}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
