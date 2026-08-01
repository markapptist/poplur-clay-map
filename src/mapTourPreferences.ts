export type MapTourTopic =
  | 'landmarks'
  | 'malls'
  | 'food'
  | 'sports'
  | 'events'
  | 'downtown'
  | 'universities'
  | 'airports'
  | 'themeParks'
  | 'casinos'
  | 'hotels'

export interface MapTourTopicOption {
  id: MapTourTopic
  label: string
  glyph: string
  defaultEnabled: boolean
}

// The June tour used a checklist rather than a single undifferentiated POI
// bucket. Keep that contract shared by the hold menu and the map iframe.
export const MAP_TOUR_TOPICS: readonly MapTourTopicOption[] = [
  { id: 'landmarks', label: 'Landmarks', glyph: '★', defaultEnabled: true },
  { id: 'malls', label: 'Malls', glyph: 'M', defaultEnabled: true },
  { id: 'food', label: 'Food spots', glyph: 'F', defaultEnabled: true },
  { id: 'sports', label: 'Sports arenas', glyph: 'S', defaultEnabled: true },
  { id: 'events', label: 'Local events', glyph: 'E', defaultEnabled: true },
  { id: 'downtown', label: 'Downtown', glyph: 'D', defaultEnabled: true },
  { id: 'universities', label: 'Universities', glyph: 'U', defaultEnabled: false },
  { id: 'airports', label: 'Airports', glyph: 'A', defaultEnabled: false },
  { id: 'themeParks', label: 'Theme parks', glyph: 'T', defaultEnabled: false },
  { id: 'casinos', label: 'Casinos', glyph: 'C', defaultEnabled: false },
  { id: 'hotels', label: 'Hotels', glyph: 'H', defaultEnabled: false },
] as const

const STORAGE_KEY = 'poplur.map.tourTopics'
const VALID_TOPICS = new Set<MapTourTopic>(MAP_TOUR_TOPICS.map(topic => topic.id))

export function defaultMapTourTopics(): MapTourTopic[] {
  return MAP_TOUR_TOPICS.filter(topic => topic.defaultEnabled).map(topic => topic.id)
}

export function normalizeMapTourTopics(value: unknown): MapTourTopic[] {
  if (!Array.isArray(value)) return defaultMapTourTopics()
  const selected = new Set(
    value.filter((topic): topic is MapTourTopic =>
      typeof topic === 'string' && VALID_TOPICS.has(topic as MapTourTopic),
    ),
  )
  if (selected.size === 0) return defaultMapTourTopics()
  return MAP_TOUR_TOPICS.map(topic => topic.id).filter(topic => selected.has(topic))
}

export function readMapTourTopics(): MapTourTopic[] {
  if (typeof window === 'undefined') return defaultMapTourTopics()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? normalizeMapTourTopics(JSON.parse(raw)) : defaultMapTourTopics()
  } catch {
    return defaultMapTourTopics()
  }
}

export function writeMapTourTopics(value: unknown): MapTourTopic[] {
  const normalized = normalizeMapTourTopics(value)
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized)) } catch { /* embedded */ }
  return normalized
}
