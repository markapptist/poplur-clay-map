/**
 * A podcast's map hand-off crosses two short-lived surfaces: Studio closes so
 * the focused map picker can take the whole screen, then Studio is reopened
 * once a spot has been chosen. Keep only that transient draft here instead of
 * pretending a current-location post is the area the host picked.
 */
export type PodcastMapPickKind = 'live' | 'recorded'

export type PodcastMapDraft = {
  kind: PodcastMapPickKind
  title: string
  genre: string
  aiEnhanced: boolean
  invitedIds: string[]
  audioUrl: string | null
  durationMs: number
}

export type PodcastMapSelection = PodcastMapDraft & {
  lat: number
  lng: number
  radiusKm?: number
}

let pending: PodcastMapDraft | null = null
let selected: PodcastMapSelection | null = null

export const beginPodcastMapPick = (draft: PodcastMapDraft) => {
  pending = draft
  selected = null
}

export const hasPendingPodcastMapPick = () => pending !== null

export const completePodcastMapPick = (spot: {
  lat: number
  lng: number
  radiusKm?: number
}) => {
  if (!pending || !Number.isFinite(spot.lat) || !Number.isFinite(spot.lng)) return false
  selected = { ...pending, ...spot }
  pending = null
  return true
}

/**
 * Read the completed map choice without consuming it. Studio can mount twice
 * in development StrictMode; consuming here made the first short-lived mount
 * steal the pin and left the real room on "Choose your path".
 */
export const readPodcastMapPick = () => selected

/**
 * Finalise a choice only after the room that restored it has committed. The
 * identity guard means a newer map trip can never be cleared by an older room.
 */
export const consumePodcastMapPick = (selection: PodcastMapSelection | null) => {
  if (selection && selected === selection) selected = null
}

/** Cancelling the map trip is the final owner of a retained local recording. */
export const clearPodcastMapPick = () => {
  const audioUrl = pending?.audioUrl ?? selected?.audioUrl
  if (audioUrl?.startsWith('blob:')) URL.revokeObjectURL(audioUrl)
  pending = null
  selected = null
}
