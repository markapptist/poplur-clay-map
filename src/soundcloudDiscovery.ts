import { isNativeShell, postNativeEvent } from './nativeBridge'
import { haversineKm } from './reach'

/** A first popularity floor. Keep it server-configurable later. */
export const SOUNDCLOUD_MIN_PLAYBACKS = 10_000

export interface NearbySoundCloudTrack {
  id: string
  title: string
  artist: string
  permalink: string
  artworkUrl: string | null
  playbackCount: number
  locationLabel: string
  locationSource: 'artist-profile' | 'track-tag'
  distanceKm: number | null
}

export interface NearbySoundCloudResult {
  tracks: NearbySoundCloudTrack[]
  configured: boolean
  error: string | null
}

declare global {
  interface Window {
    /** Poplur's server-side, opt-in SoundCloud artist index. Never an API key. */
    __poplurSoundCloudNearbyEndpoint?: string
  }
}

const NATIVE_DISCOVERY_EVENT = 'poplur-native-nearby-soundcloud'
const NATIVE_DISCOVERY_TIMEOUT_MS = 3_000
let nativeDiscoveryRequest = 0

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null
const finite = (value: unknown) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function soundCloudPermalink(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || !/(^|\.)soundcloud\.com$/i.test(url.hostname)) return null
    return url.toString()
  } catch {
    return null
  }
}

function httpsResource(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function normaliseTrack(
  value: unknown,
  origin: [number, number],
  radiusKm: number,
): NearbySoundCloudTrack | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>

  // Only artists who deliberately connected/claimed their account belong in
  // Poplur's geographic index. A free-text city scraped from an arbitrary
  // SoundCloud profile is neither consent nor reliable proximity.
  if (row.artistOptIn !== true && row.optIn !== true) return null
  const permalink = soundCloudPermalink(row.permalink ?? row.permalink_url ?? row.url)
  const playbackCount = finite(row.playbackCount ?? row.playback_count)
  if (!permalink || playbackCount == null || playbackCount < SOUNDCLOUD_MIN_PLAYBACKS) return null

  const locationSource = row.locationSource === 'track-tag' || row.location_source === 'track-tag'
    ? 'track-tag'
    : 'artist-profile'
  const city = text(row.city)
  const country = text(row.country)
  const suppliedLabel = text(row.locationLabel ?? row.location_label)
  const locationLabel = suppliedLabel ?? [city, country].filter(Boolean).join(', ')
  if (!locationLabel) return null

  const lat = finite(row.lat ?? row.latitude)
  const lng = finite(row.lng ?? row.longitude)
  const suppliedDistance = finite(row.distanceKm ?? row.distance_km)
  const distanceKm = lat != null && lng != null
    ? haversineKm(origin, [lng, lat])
    : suppliedDistance
  // Coordinate-bearing results are independently radius checked on-device.
  // City-only matches have already been geocoded and filtered by the server.
  if (distanceKm != null && distanceKm > radiusKm) return null

  const title = text(row.title)
  const artist = text(row.artist ?? row.username ?? row.user)
  if (!title || !artist) return null

  return {
    id: text(row.id) ?? `sc-${permalink}`,
    title,
    artist,
    permalink,
    artworkUrl: httpsResource(row.artworkUrl ?? row.artwork_url),
    playbackCount,
    locationLabel,
    locationSource,
    distanceKm,
  }
}

function normaliseTracks(
  rows: unknown[],
  lat: number,
  lng: number,
  radiusKm: number,
): NearbySoundCloudTrack[] {
  const origin: [number, number] = [lng, lat]
  return rows
    .map(row => normaliseTrack(row, origin, radiusKm))
    .filter((track): track is NearbySoundCloudTrack => Boolean(track))
    .sort((a, b) => b.playbackCount - a.playbackCount || (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))
}

function rowsFromPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  const rows = (payload as { tracks?: unknown }).tracks
  return Array.isArray(rows) ? rows : []
}

/**
 * Native is allowed to inject the output of Poplur's server-side discovery
 * index, but never a SoundCloud credential. This is deliberately a one-shot
 * bridge request: the iPod owns when it refreshes, and an older response may
 * not update a newer location's list.
 *
 * Native contract:
 *   request { type: 'requestNearbySoundCloud', requestId, latitude,
 *             longitude, radiusKm, minimumPlaybackCount }
 *   event   poplur-native-nearby-soundcloud detail { requestId, tracks,
 *             configured?: boolean, error?: string }
 */
function discoverNearbySoundCloudViaNative(
  lat: number,
  lng: number,
  radiusKm: number,
  signal?: AbortSignal,
): Promise<NearbySoundCloudResult | null> {
  if (!isNativeShell() || signal?.aborted) return Promise.resolve(null)

  const requestId = `nearby_soundcloud_${++nativeDiscoveryRequest}`
  return new Promise(resolve => {
    let settled = false
    let timer = 0
    const finish = (result: NearbySoundCloudResult | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      window.removeEventListener(NATIVE_DISCOVERY_EVENT, onResult)
      signal?.removeEventListener('abort', abort)
      resolve(result)
    }
    const abort = () => finish(null)
    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<{
        requestId?: unknown
        tracks?: unknown
        configured?: unknown
        error?: unknown
      }>).detail
      if (!detail || detail.requestId !== requestId) return
      const error = text(detail.error)
      finish({
        tracks: normaliseTracks(rowsFromPayload(detail), lat, lng, radiusKm),
        configured: detail.configured !== false,
        error,
      })
    }

    window.addEventListener(NATIVE_DISCOVERY_EVENT, onResult)
    signal?.addEventListener('abort', abort, { once: true })
    timer = window.setTimeout(() => finish(null), NATIVE_DISCOVERY_TIMEOUT_MS)
    if (!postNativeEvent({
      type: 'requestNearbySoundCloud',
      requestId,
      latitude: lat,
      longitude: lng,
      radiusKm,
      minimumPlaybackCount: SOUNDCLOUD_MIN_PLAYBACKS,
    })) finish(null)
  })
}

/**
 * Query Poplur's backend index of artists who opted into nearby discovery.
 * SoundCloud credentials/tokens must stay on that backend; the web/native
 * bundle receives only attributed track cards and opens playback in the
 * official SoundCloud experience.
 */
export async function discoverNearbySoundCloud(
  lat: number,
  lng: number,
  radiusKm: number,
  signal?: AbortSignal,
): Promise<NearbySoundCloudResult> {
  const configuredEndpoint = window.__poplurSoundCloudNearbyEndpoint
    ?? (import.meta.env.VITE_SOUNDCLOUD_NEARBY_ENDPOINT as string | undefined)
  if (!configuredEndpoint) {
    const nativeResult = await discoverNearbySoundCloudViaNative(lat, lng, radiusKm, signal)
    return nativeResult ?? { tracks: [], configured: false, error: null }
  }

  let endpoint: URL
  try {
    endpoint = new URL(configuredEndpoint, window.location.href)
    if (endpoint.protocol !== 'https:' && endpoint.hostname !== '127.0.0.1' && endpoint.hostname !== 'localhost') {
      return { tracks: [], configured: false, error: 'Discovery endpoint must use HTTPS.' }
    }
  } catch {
    return { tracks: [], configured: false, error: 'Discovery endpoint is invalid.' }
  }

  endpoint.searchParams.set('lat', String(lat))
  endpoint.searchParams.set('lng', String(lng))
  endpoint.searchParams.set('radiusKm', String(radiusKm))
  endpoint.searchParams.set('minimumPlaybackCount', String(SOUNDCLOUD_MIN_PLAYBACKS))

  try {
    const response = await fetch(endpoint, {
      signal,
      headers: { Accept: 'application/json' },
      credentials: 'omit',
    })
    if (!response.ok) throw new Error(`SoundCloud discovery returned ${response.status}`)
    const body = await response.json() as unknown
    return { tracks: normaliseTracks(rowsFromPayload(body), lat, lng, radiusKm), configured: true, error: null }
  } catch (error) {
    if (signal?.aborted) return { tracks: [], configured: true, error: null }
    return {
      tracks: [],
      configured: true,
      error: error instanceof Error ? error.message : 'SoundCloud discovery is unavailable.',
    }
  }
}

export function openSoundCloudTrack(track: NearbySoundCloudTrack): void {
  if (postNativeEvent({ type: 'openInAppBrowser', url: track.permalink })) return
  const opened = window.open(track.permalink, '_blank', 'noopener,noreferrer')
  if (!opened) window.location.assign(track.permalink)
}
