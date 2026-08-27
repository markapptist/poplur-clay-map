import { useState } from 'react'
import SideControlIconButton, { SideControlIconImage } from './SideControlIcon'
import {
  SIDE_CONTROL_ICON_IDS,
  SIDE_CONTROL_ICONS,
  WEATHER_ICON_IDS,
  WEATHER_ICONS,
  type PoplurSideIconId,
  type PoplurSideIconSize,
} from './sideControlIcons'
import styles from './SideControlIconGallery.module.css'

const BACKGROUNDS = ['light', 'dark', 'pattern'] as const
const SOURCE_SIZES = [256, 512, 1024] as const satisfies readonly PoplurSideIconSize[]

function BackgroundChecks({ icon }: { icon: PoplurSideIconId }) {
  return (
    <div className={styles.backgrounds} aria-label="Background checks">
      {BACKGROUNDS.map(background => (
        <div key={background} className={`${styles.background} ${styles[background]}`}>
          <SideControlIconImage icon={icon} displaySize={44} loading="lazy" />
          <span>{background}</span>
        </div>
      ))}
    </div>
  )
}

function StateChecks({ icon }: { icon: PoplurSideIconId }) {
  return (
    <div className={`${styles.states} ${styles.pattern}`} aria-label="Interaction-state checks">
      <span><SideControlIconButton icon={icon} aria-label={`${icon}, normal`} /><b>normal</b></span>
      <span><SideControlIconButton icon={icon} aria-label={`${icon}, pressed`} forcePressed /><b>pressed</b></span>
      <span><SideControlIconButton icon={icon} aria-label={`${icon}, selected`} aria-pressed="true" /><b>selected</b></span>
      <span><SideControlIconButton icon={icon} aria-label={`${icon}, disabled`} disabled /><b>disabled</b></span>
      <span><SideControlIconButton icon={icon} aria-label={`${icon}, loading`} loading /><b>loading</b></span>
    </div>
  )
}

function IconCard({ icon }: { icon: (typeof SIDE_CONTROL_ICON_IDS)[number] }) {
  const definition = SIDE_CONTROL_ICONS[icon]
  return (
    <article className={styles.card} data-gallery-icon={icon}>
      <header>
        <code>{icon}</code>
        <p>{definition.purpose}</p>
        <small>Label: {definition.accessibilityLabel}</small>
      </header>
      <BackgroundChecks icon={icon} />
      <StateChecks icon={icon} />
    </article>
  )
}

function SourceComparison({ icon }: { icon: PoplurSideIconId }) {
  return (
    <article className={styles.comparison}>
      <code>{icon}</code>
      <div>
        {SOURCE_SIZES.map(size => (
          <span key={size}>
            <SideControlIconImage
              icon={icon}
              displaySize={72}
              sourceSize={size}
              loading="lazy"
            />
            <b>{size}</b>
          </span>
        ))}
      </div>
    </article>
  )
}

/**
 * Development-only visual QA. main.tsx code-splits this route so its complete
 * matrix, including the opt-in 1024 authoring comparison, cannot enter normal
 * application startup or production navigation.
 */
export default function SideControlIconGallery() {
  const [showSourceComparisons, setShowSourceComparisons] = useState(false)

  return (
    <main className={styles.gallery} data-poplur-side-icon-gallery="">
      <header className={styles.hero}>
        <p>Poplur developer visual QA</p>
        <h1>Side-control icon gallery</h1>
        <span>{SIDE_CONTROL_ICON_IDS.length} controls · {WEATHER_ICON_IDS.length} conditions</span>
      </header>

      <section aria-labelledby="control-icon-heading">
        <h2 id="control-icon-heading">Side controls</h2>
        <div className={styles.grid}>
          {SIDE_CONTROL_ICON_IDS.map(icon => <IconCard key={icon} icon={icon} />)}
        </div>
      </section>

      <section aria-labelledby="weather-icon-heading">
        <h2 id="weather-icon-heading">Weather conditions</h2>
        <div className={styles.weatherGrid}>
          {WEATHER_ICON_IDS.map(icon => (
            <article key={icon} className={styles.weatherCard} data-gallery-icon={icon}>
              <code>{icon}</code>
              <p>{WEATHER_ICONS[icon].purpose}</p>
              <BackgroundChecks icon={icon} />
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="source-size-heading">
        <h2 id="source-size-heading">Source-size comparison</h2>
        <p className={styles.note}>
          The 1024px authoring masters are not mounted until this developer-only check is opened.
        </p>
        <button
          type="button"
          className={styles.reveal}
          aria-expanded={showSourceComparisons}
          onClick={() => setShowSourceComparisons(value => !value)}
        >
          {showSourceComparisons ? 'Hide 256 / 512 / 1024 comparisons' : 'Load 256 / 512 / 1024 comparisons'}
        </button>
        {showSourceComparisons && (
          <div className={styles.comparisonGrid}>
            {[...SIDE_CONTROL_ICON_IDS, ...WEATHER_ICON_IDS].map(icon => (
              <SourceComparison key={icon} icon={icon} />
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
