import styles from './MapShowMe.module.css'
import {
  MAP_TOUR_TOPICS,
  defaultMapTourTopics,
  type MapTourTopic,
} from './mapTourPreferences'

export default function MapShowMe({
  selected,
  onChange,
  onClose,
}: {
  selected: MapTourTopic[]
  onChange: (topics: MapTourTopic[]) => void
  onClose: () => void
}) {
  const active = new Set(selected.length ? selected : defaultMapTourTopics())
  const toggle = (topic: MapTourTopic) => {
    const next = new Set(active)
    if (next.has(topic)) {
      if (next.size === 1) return
      next.delete(topic)
    } else {
      next.add(topic)
    }
    onChange(MAP_TOUR_TOPICS.map(option => option.id).filter(id => next.has(id)))
  }

  return (
    <section className={styles.screen} aria-label="Choose what the map shows">
      <header className={styles.header}>
        <p className={styles.eyebrow}>MAP TOUR</p>
        <h2>SHOW ME</h2>
        <p>Choose the places Poplur visits.</p>
      </header>
      <div className={styles.grid}>
        {MAP_TOUR_TOPICS.map(topic => {
          const on = active.has(topic.id)
          return (
            <button
              key={topic.id}
              type="button"
              className={styles.topic}
              data-selected={on ? 'true' : 'false'}
              aria-pressed={on}
              onClick={() => toggle(topic.id)}
            >
              <span className={styles.glyph} aria-hidden="true">{topic.glyph}</span>
              <span>{topic.label}</span>
              <span className={styles.check} aria-hidden="true">{on ? '✓' : ''}</span>
            </button>
          )
        })}
      </div>
      <button type="button" className={styles.done} onClick={onClose}>DONE</button>
    </section>
  )
}
