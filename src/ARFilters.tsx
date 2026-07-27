import React from 'react'
import styles from './ARFilters.module.css'
import { playPop } from './pop'

// AR filters — the web twin of ARFilterManager.swift, carrying the same set it
// ships (none · Smooth · Beauty · Brighten · Glow · Sharpen · Warm · Cool ·
// Vintage). The native app runs them as CIFilters over the frame buffer; here
// they are CSS filter chains over the live <video>, which the compositor
// applies to every frame — so they are live on your face, not a preview of an
// effect that happens later.

export interface ARFilterDef {
  id: string
  label: string
  /** CSS filter chain applied to the live video */
  css: string
}

export const AR_FILTERS: ARFilterDef[] = [
  { id: 'none', label: 'None', css: 'none' },
  // The blur is tiny and paired with a contrast lift: skin softens, edges hold.
  { id: 'smooth', label: 'Smooth', css: 'blur(1.1px) contrast(1.06) saturate(1.04)' },
  { id: 'beauty', label: 'Beauty', css: 'blur(0.8px) brightness(1.08) saturate(1.12) contrast(1.04)' },
  { id: 'brighten', label: 'Brighten', css: 'brightness(1.22) contrast(0.96)' },
  { id: 'glow', label: 'Glow', css: 'brightness(1.12) saturate(1.2) contrast(1.05) drop-shadow(0 0 12px rgba(255,190,225,0.55))' },
  { id: 'sharpen', label: 'Sharpen', css: 'contrast(1.3) saturate(1.1)' },
  { id: 'warm', label: 'Warm', css: 'sepia(0.28) saturate(1.35) hue-rotate(-12deg) brightness(1.05)' },
  { id: 'cool', label: 'Cool', css: 'saturate(1.15) hue-rotate(14deg) brightness(1.03) contrast(1.06)' },
  { id: 'vintage', label: 'Vintage', css: 'sepia(0.55) contrast(1.15) saturate(0.85) brightness(0.98)' },
]

export default function ARFilters({
  active,
  onPick,
  onClose,
}: {
  active: string
  onPick: (id: string) => void
  onClose: () => void
}) {
  return (
    <div className={styles.rail} role="dialog" aria-label="AR filters">
      <div className={styles.head}>
        <span className={styles.title}>AR FILTERS</span>
        <button className={styles.close} type="button" onClick={() => { playPop(); onClose() }} aria-label="Close AR filters">✕</button>
      </div>
      <div className={styles.strip}>
        {AR_FILTERS.map(f => (
          <button
            key={f.id}
            type="button"
            className={f.id === active ? `${styles.chip} ${styles.chipOn}` : styles.chip}
            onClick={() => { playPop(); onPick(f.id) }}
            aria-pressed={f.id === active}
          >
            {/* the swatch wears the filter it applies, so the strip previews
                itself instead of naming nine effects you cannot see */}
            <span className={styles.swatch} style={{ filter: f.css === 'none' ? undefined : f.css }} />
            <span className={styles.chipLabel}>{f.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
