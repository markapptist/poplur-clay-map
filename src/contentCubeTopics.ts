import type { MapTourTopic } from './mapTourPreferences'

/**
 * Topics the navigator has a cube for.
 *
 * Deliberately a SUBSET of MapTourTopic rather than a new vocabulary: the map
 * tour already curates those words, the hold menu already lets you toggle
 * them, and the tour's own narration already knows which one it is speaking
 * about (TOUR_TOPIC_FOR_KIND maps an arena stop to 'sports'). Reusing it means
 * a topic earns a cube by having a model, not by being re-listed somewhere.
 *
 * Adding food later is one line here plus a model — not new machinery. The
 * fork/knife GLB already ships and is already sprite-baked; it is unwired
 * because the reducer that drove it was orphaned, not because it is missing.
 */
export type ContentCubeTopic = Extract<MapTourTopic, 'sports' | 'food'>

const TOPIC_CUBE_MODELS: Partial<Record<ContentCubeTopic, string>> = {
  sports: 'poplur_cube_basketball.glb',
  // food: 'poplur_cube_fork_knife.glb' — the model and its sprites ship, but
  // the food triggers are not wired yet. Left here as the shape of the next
  // topic rather than switched on silently.
}

/** How long a content cube holds the navigator before handing it back.
 *
 *  Ten seconds, matching the radio's existing disco appearance
 *  (RADIO_DISCO_CUBE_MS) rather than the weather cube's four: weather is a
 *  glance at a condition, while this is an announcement about what you are
 *  watching or listening to, and it has to outlast a look down at the phone. */
export const CONTENT_CUBE_DISPLAY_MS = 10_000

export function contentCubeModel(topic: ContentCubeTopic | null | undefined): string | null {
  return topic ? TOPIC_CUBE_MODELS[topic] ?? null : null
}

/** Which feed channel means which topic. The channel catalogue is hand-authored
 *  and its ids are stable, so this is an exact read rather than a guess at a
 *  caption. A channel with no cube topic simply returns null. */
export function topicForFeedChannel(channelId: string | null | undefined): ContentCubeTopic | null {
  if (channelId === 'sports') return 'sports'
  return null
}

/** Which spoken tour topic means which cube topic. The app authors those words
 *  itself and already knows the stop's topic, so this is exact too — unlike a
 *  station name, which is the one signal this feature deliberately does not
 *  use (The Fan 590, TSN 1050 and talkSPORT all carry no "sport" in them). */
export function topicForSpokenTour(tourTopic: string | null | undefined): ContentCubeTopic | null {
  return tourTopic === 'sports' ? 'sports' : null
}
