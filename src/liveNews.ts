import { useCallback, useEffect, useState } from 'react'

/**
 * One immutable story record is shared by the map tour and The Poplur Times.
 * Sources decide that an event exists and where it happened; AI may only write
 * the explicitly labelled summary.  That separation is important: a model must
 * never be allowed to invent a breaking event or move it to a more exciting
 * location.
 */
export type LiveNewsStatus = 'breaking' | 'live' | 'developing' | 'top'
export type LiveNewsScope = 'local' | 'regional' | 'national' | 'global'

export interface LiveNewsSource {
  publisher: string
  url: string
  publishedAt?: string
}

export interface LiveNewsMedia {
  kind: 'photo' | 'video'
  src: string
  poster?: string
  credit: string
  sourceUrl: string
  rights: 'provider-thumbnail' | 'official-embed' | 'licensed' | 'preview'
}

export interface LiveNewsEvent {
  id: string
  title: string
  /** Source-derived editorial summary. AI may refine this server-side, but it
   * may never invent the event, its location, status, or corroboration. */
  summary: string
  status: LiveNewsStatus
  place: string
  country?: string
  coords: [number, number]
  scope: LiveNewsScope
  category: string
  publishedAt: string
  updatedAt: string
  confidence: number
  sources: LiveNewsSource[]
  media: LiveNewsMedia[]
  /** Development-only deterministic wire used by the browser tour harness. */
  preview?: boolean
}

export interface LiveNewsSnapshot {
  events: LiveNewsEvent[]
  generatedAt: string | null
  checkedAt: string | null
  loading: boolean
  stale: boolean
  source: 'network' | 'cache' | 'preview' | 'empty'
  error: string | null
}

export interface ParsedLiveNewsResponse {
  events: LiveNewsEvent[]
  generatedAt: string | null
  checkedAt: string | null
  stale: boolean
}

const DEFAULT_ENDPOINT = 'https://us-central1-poplur2025.cloudfunctions.net/liveNewsApi'
const CACHE_KEY = 'poplur.live-news.v1'
const CACHE_FRESH_MS = 5 * 60_000
/**
 * How long to sit out after a failed wire fetch.
 *
 * Only the SUCCESS path wrote a cache entry, so a wire that is down was
 * re-fetched on every map mount, every 5-minute foreground tick, every
 * visibilitychange and every `online` event, forever, with no backoff. When
 * the endpoint was returning 404 that was a request storm nobody could see —
 * the paper still filled with local drops, so it looked fine.
 *
 * Deliberately shorter than CACHE_FRESH_MS: a wire that comes back should be
 * picked up on the next ordinary refresh, not punished for having been down.
 */
const FAILURE_BACKOFF_MS = 60_000
const CACHE_MAX_MS = 24 * 60 * 60_000
const EVENT_MAX_AGE_MS = 7 * 24 * 60 * 60_000
const WIRE_STALE_MS = 90 * 60_000
const MAX_EVENTS = 40
const FOREGROUND_REFRESH_MS = 5 * 60_000

const STATUS_SCORE: Record<LiveNewsStatus, number> = {
  breaking: 400,
  live: 300,
  developing: 200,
  top: 100,
}

function textField(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2_048) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null
    const hostname = url.hostname.toLowerCase()
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) return null
    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
    if (ipv4) {
      const octets = ipv4.slice(1).map(Number)
      if (octets.some(octet => octet > 255)
        || octets[0] === 0 || octets[0] === 10 || octets[0] === 127
        || octets[0] >= 224
        || octets[0] === 169 && octets[1] === 254
        || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31
        || octets[0] === 192 && octets[1] === 168) return null
    }
    const ipv6 = /^\[([0-9a-f:.]+)\]$/i.exec(hostname)?.[1]?.toLowerCase()
    if (ipv6 && (
      ipv6 === '::'
      || ipv6 === '::1'
      // URL canonicalization turns dotted IPv4-mapped literals into this hex
      // form. Reject every mapped address rather than accidentally accepting
      // a loopback/private IPv4 target through its IPv6 spelling.
      || ipv6.startsWith('::ffff:')
      || /^(?:fc|fd)/.test(ipv6)
      || /^fe[89abcdef]/.test(ipv6)
      || /^ff/.test(ipv6)
    )) return null
    return url.toString()
  } catch {
    return null
  }
}

function isDevelopmentLoopback(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized === '127.0.0.1'
    || normalized === '[::1]'
}

/** Validate a configured wire endpoint before fetch. Production overrides are
 * always public HTTPS; only a development build may opt into loopback HTTP. */
export function liveNewsEndpoint(value: unknown, allowLocalHttp = import.meta.env.DEV): URL {
  const supplied = typeof value === 'string' ? value.trim() : ''
  const endpoint = supplied || DEFAULT_ENDPOINT
  if (endpoint.length > 2_048) throw new Error('News endpoint is invalid.')
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new Error('News endpoint is invalid.')
  }
  if (!url.hostname || url.username || url.password) throw new Error('News endpoint is invalid.')
  if (url.protocol === 'https:') {
    const safe = httpsUrl(url.toString())
    if (!safe) throw new Error('News endpoint must use a public HTTPS host.')
    return new URL(safe)
  }
  if (url.protocol === 'http:' && allowLocalHttp && isDevelopmentLoopback(url.hostname)) return url
  throw new Error('News endpoint must use HTTPS.')
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

function coordinates(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null
  const longitude = Number(value[0])
  const latitude = Number(value[1])
  if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) return null
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) return null
  return [longitude, latitude]
}

function sourceField(value: unknown): LiveNewsSource | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const publisher = textField(record.publisher, 100)
  const url = httpsUrl(record.url)
  if (!publisher || !url) return null
  const publishedAt = isoDate(record.publishedAt)
  return { publisher, url, ...(publishedAt ? { publishedAt } : {}) }
}

function mediaField(value: unknown): LiveNewsMedia | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const kind = record.kind === 'photo' || record.kind === 'video' ? record.kind : null
  const src = httpsUrl(record.src)
  const sourceUrl = httpsUrl(record.sourceUrl)
  const credit = textField(record.credit, 140)
  const rights = record.rights === 'provider-thumbnail'
    || record.rights === 'official-embed'
    || record.rights === 'licensed'
    ? record.rights
    : null
  if (!kind || !src || !sourceUrl || !credit || !rights) return null
  const poster = kind === 'video' ? httpsUrl(record.poster) : null
  return { kind, src, sourceUrl, credit, rights, ...(poster ? { poster } : {}) }
}

function eventField(value: unknown, nowMs: number): LiveNewsEvent | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const id = textField(record.id, 180)
  const title = textField(record.title, 220)
  const summary = textField(record.summary, 520)
  const place = textField(record.place, 160)
  const country = textField(record.country, 100)
  const category = textField(record.category, 80) || 'world'
  const coords = coordinates(record.coords)
  const status = record.status === 'breaking' || record.status === 'live'
    || record.status === 'developing' || record.status === 'top'
    ? record.status
    : null
  const scope = record.scope === 'local' || record.scope === 'regional'
    || record.scope === 'national' || record.scope === 'global'
    ? record.scope
    : null
  const publishedAt = isoDate(record.publishedAt)
  const updatedAt = isoDate(record.updatedAt) ?? publishedAt
  const confidence = Number(record.confidence)
  const sources = Array.isArray(record.sources)
    ? record.sources.map(sourceField).filter((item): item is LiveNewsSource => Boolean(item)).slice(0, 6)
    : []
  const media = Array.isArray(record.media)
    ? record.media.map(mediaField).filter((item): item is LiveNewsMedia => Boolean(item)).slice(0, 4)
    : []

  if (!id || !title || !summary || !place || !coords || !status || !scope || !publishedAt || !updatedAt) return null
  if (!Number.isFinite(confidence) || confidence < 0.5 || confidence > 1) return null
  if (sources.length === 0) return null
  const age = nowMs - Date.parse(updatedAt)
  if (age > EVENT_MAX_AGE_MS || age < -60 * 60_000) return null

  return {
    id,
    title,
    summary,
    status,
    place,
    ...(country ? { country } : {}),
    coords,
    scope,
    category,
    publishedAt,
    updatedAt,
    confidence,
    sources,
    media,
  }
}

/** Strict client boundary: malformed, unsourced, stale and unsafe records do
 * not reach either UI. The server applies the same policy before publishing. */
export function parseLiveNewsPayload(value: unknown, nowMs = Date.now()): LiveNewsEvent[] {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { events?: unknown }).events)
      ? (value as { events: unknown[] }).events
      : []
  const deduped = new Map<string, LiveNewsEvent>()
  for (const item of raw) {
    const event = eventField(item, nowMs)
    if (!event) continue
    const existing = deduped.get(event.id)
    if (!existing || Date.parse(event.updatedAt) > Date.parse(existing.updatedAt)) deduped.set(event.id, event)
  }
  return rankLiveNewsEvents([...deduped.values()]).slice(0, MAX_EVENTS)
}

function recordField(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function wireIsStale(record: Record<string, unknown> | null, checkedAt: string | null, nowMs: number): boolean {
  if (record?.stale === true) return true
  // A malformed freshness claim is not permission to present the edition as
  // current. Missing `stale` remains compatible with the earlier wire shape.
  if (record && 'stale' in record && typeof record.stale !== 'boolean') return true
  if (!checkedAt) return true
  const ageMs = nowMs - Date.parse(checkedAt)
  return !Number.isFinite(ageMs) || ageMs > WIRE_STALE_MS || ageMs < -60 * 60_000
}

/** Parse both the event list and the server's freshness envelope. Freshness is
 * conservative: an explicit stale response, an invalid marker, or an old
 * `checkedAt` can never be downgraded to fresh by the client. */
export function parseLiveNewsResponse(value: unknown, nowMs = Date.now()): ParsedLiveNewsResponse {
  const record = recordField(value)
  const generatedAt = isoDate(record?.generatedAt)
  const suppliedCheckedAt = Boolean(record && 'checkedAt' in record)
  const checkedAt = isoDate(record?.checkedAt) ?? (suppliedCheckedAt ? null : generatedAt)
  return {
    events: parseLiveNewsPayload(value, nowMs),
    generatedAt,
    checkedAt,
    stale: wireIsStale(record, checkedAt, nowMs),
  }
}

export function rankLiveNewsEvents(events: LiveNewsEvent[], nowMs = Date.now()): LiveNewsEvent[] {
  return [...events].sort((a, b) => {
    const recencyA = Math.max(0, 72 - (nowMs - Date.parse(a.updatedAt)) / 3_600_000)
    const recencyB = Math.max(0, 72 - (nowMs - Date.parse(b.updatedAt)) / 3_600_000)
    const scoreA = STATUS_SCORE[a.status] + a.confidence * 80 + Math.min(a.sources.length, 3) * 12 + recencyA
    const scoreB = STATUS_SCORE[b.status] + b.confidence * 80 + Math.min(b.sources.length, 3) * 12 + recencyB
    return scoreB - scoreA || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  })
}

/** Only corroborated, recent and precise records may move the camera. */
export function tourEligibleLiveNewsEvents(events: LiveNewsEvent[], nowMs = Date.now()): LiveNewsEvent[] {
  return rankLiveNewsEvents(events, nowMs).filter(event => {
    const ageMs = nowMs - Date.parse(event.updatedAt)
    const corroborated = event.sources.length >= 2 || event.confidence >= 0.9
    return event.confidence >= 0.72 && corroborated && ageMs >= 0 && ageMs <= 72 * 60 * 60_000
  }).slice(0, 12)
}

export function liveNewsCameraFrame(event: LiveNewsEvent) {
  const zoom = event.scope === 'local' ? 12.2
    : event.scope === 'regional' ? 9.2
      : event.scope === 'national' ? 5.7
        : 3.1
  return {
    center: event.coords,
    zoom,
    pitch: event.scope === 'local' ? 54 : event.scope === 'regional' ? 46 : 28,
    bearing: ((event.coords[0] * 7 + event.coords[1] * 11) % 50) - 25,
  }
}

export function liveNewsRadiusKm(event: LiveNewsEvent): number {
  return event.scope === 'local' ? 5 : event.scope === 'regional' ? 60 : event.scope === 'national' ? 500 : 2_000
}

export function liveNewsWhen(event: LiveNewsEvent, nowMs = Date.now()): string {
  const minutes = Math.max(0, Math.floor((nowMs - Date.parse(event.updatedAt)) / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/** Plainly labelled deterministic data. It keeps the explicit Map News action
 * interactive when the production provider is unavailable, without ever
 * presenting simulated stories as verified LIVE/BREAKING reporting. */
export function previewLiveNewsEvents(nowMs = Date.now()): LiveNewsEvent[] {
  const at = (minutesAgo: number) => new Date(nowMs - minutesAgo * 60_000).toISOString()
  const source = (publisher: string, slug: string, publishedAt: string): LiveNewsSource => ({
    publisher,
    url: `https://example.com/poplur-news-preview/${slug}`,
    publishedAt,
  })
  const events: LiveNewsEvent[] = [
    {
      id: 'preview-toronto-parade',
      title: 'A city parade is moving through the downtown core',
      summary: 'A route preview shows how Poplur News can combine confirmed updates, street media and the map into one live stop.',
      status: 'live', place: 'Toronto, Ontario', country: 'Canada', coords: [-79.3832, 43.6532],
      scope: 'local', category: 'events', publishedAt: at(24), updatedAt: at(4), confidence: 0.94,
      sources: [source('Poplur News preview', 'toronto-parade-a', at(24)), source('City desk preview', 'toronto-parade-b', at(9))],
      media: [{ kind: 'photo', src: '/holdmenu/News.png', credit: 'Poplur News interaction preview', sourceUrl: 'https://example.com/poplur-news-preview/toronto-parade-a', rights: 'preview' }],
      preview: true,
    },
    {
      id: 'preview-paris-festival',
      title: 'Night festival draws crowds along the Seine',
      summary: 'This simulated stop demonstrates a regional live-event frame, source cards and a clean handoff into The Poplur Times.',
      status: 'developing', place: 'Paris', country: 'France', coords: [2.3522, 48.8566],
      scope: 'regional', category: 'culture', publishedAt: at(71), updatedAt: at(18), confidence: 0.91,
      sources: [source('Poplur News preview', 'paris-festival-a', at(71)), source('Culture desk preview', 'paris-festival-b', at(33))],
      media: [{ kind: 'photo', src: '/channels/poplur_channel_109_news.png', credit: 'Poplur News interaction preview', sourceUrl: 'https://example.com/poplur-news-preview/paris-festival-a', rights: 'preview' }],
      preview: true,
    },
    {
      id: 'preview-tokyo-transit',
      title: 'Transit update changes the evening rush',
      summary: 'A simulated multi-source update is grouped once, placed at preview coordinates and ranked for a finite worldwide tour.',
      status: 'breaking', place: 'Tokyo', country: 'Japan', coords: [139.6917, 35.6895],
      scope: 'regional', category: 'transport', publishedAt: at(42), updatedAt: at(7), confidence: 0.93,
      sources: [source('Poplur News preview', 'tokyo-transit-a', at(42)), source('Transit desk preview', 'tokyo-transit-b', at(11))],
      media: [{ kind: 'photo', src: '/holdmenu/News.png', credit: 'Poplur News interaction preview', sourceUrl: 'https://example.com/poplur-news-preview/tokyo-transit-a', rights: 'preview' }],
      preview: true,
    },
  ]
  return rankLiveNewsEvents(events, nowMs)
}

/** Resolve one explicit Map News press. Fresh verified stories always win;
 * stale/empty provider states fall back to the visibly labelled tour preview
 * instead of turning the side button into a silent no-op or navigating away
 * from the Map. */
export function newsTourEventsForSnapshot(
  snapshot: Pick<LiveNewsSnapshot, 'events' | 'stale'>,
  nowMs = Date.now(),
): LiveNewsEvent[] {
  const verified = snapshot.stale ? [] : tourEligibleLiveNewsEvents(snapshot.events, nowMs)
  return verified.length ? verified : previewLiveNewsEvents(nowMs)
}

/** A stale provider must stop a genuine live-news camera pass, but it must not
 * cancel an in-flight request or the explicitly labelled preview fallback.
 * Keeping that distinction pure makes the async edge testable without a DOM. */
export function staleProviderStopsNewsTour(
  stale: boolean,
  active: boolean,
  runEvents: readonly LiveNewsEvent[],
): boolean {
  return stale && active && runEvents.some(event => !event.preview)
}

type CachedWire = {
  storedAt: number
  generatedAt: string | null
  checkedAt: string | null
  stale: boolean
  events: unknown[]
}

export function parseLiveNewsCache(value: unknown, nowMs: number): (ParsedLiveNewsResponse & { ageMs: number }) | null {
  const record = recordField(value)
  if (!record) return null
  const ageMs = nowMs - Number(record.storedAt)
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > CACHE_MAX_MS) return null
  const parsed = parseLiveNewsResponse(record, nowMs)
  return parsed.events.length ? { ...parsed, ageMs } : null
}

function readCache(nowMs: number): (ParsedLiveNewsResponse & { ageMs: number }) | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    return parseLiveNewsCache(JSON.parse(raw), nowMs)
  } catch {
    return null
  }
}

function writeCache(events: LiveNewsEvent[], generatedAt: string | null, checkedAt: string | null, stale: boolean, nowMs: number) {
  try {
    const cache: CachedWire = { storedAt: nowMs, generatedAt, checkedAt, stale, events }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch { /* a private browser may deny storage; the in-memory snapshot remains */ }
}

const listeners = new Set<(snapshot: LiveNewsSnapshot) => void>()
let inflight: Promise<LiveNewsSnapshot> | null = null
/** When the wire last failed, so a dead endpoint is not re-asked every tick. */
let lastFailureAtMs: number | null = null
let snapshot: LiveNewsSnapshot = {
  events: [], generatedAt: null, checkedAt: null, loading: false, stale: false, source: 'empty', error: null,
}

function publish(next: LiveNewsSnapshot) {
  snapshot = next
  listeners.forEach(listener => listener(next))
  return next
}

function subscribe(listener: (next: LiveNewsSnapshot) => void) {
  listeners.add(listener)
  listener(snapshot)
  return () => { listeners.delete(listener) }
}

export async function loadLiveNews(force = false): Promise<LiveNewsSnapshot> {
  if (inflight) return inflight
  const nowMs = Date.now()
  // Deterministic browser QA without waiting for the remote timeout. This is
  // development-only and plainly labelled PREVIEW everywhere it is rendered.
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('news-test') === '1') {
    const checkedAt = new Date(nowMs).toISOString()
    return publish({
      events: previewLiveNewsEvents(nowMs),
      generatedAt: checkedAt,
      checkedAt,
      loading: false,
      stale: false,
      source: 'preview',
      error: null,
    })
  }
  const cached = readCache(nowMs)
  // A recent failure suppresses the retry, but never a user-forced refresh:
  // `force` is the reader explicitly asking, and it must always reach the wire.
  if (!force && lastFailureAtMs != null && nowMs - lastFailureAtMs < FAILURE_BACKOFF_MS) {
    return publish({ ...snapshot, loading: false })
  }
  if (!force && cached && cached.ageMs <= CACHE_FRESH_MS) {
    return publish({
      events: cached.events,
      generatedAt: cached.generatedAt,
      checkedAt: cached.checkedAt,
      loading: false,
      stale: cached.stale,
      source: 'cache',
      error: cached.stale ? 'Showing the latest saved edition.' : null,
    })
  }
  publish({
    events: cached?.events ?? snapshot.events,
    generatedAt: cached?.generatedAt ?? snapshot.generatedAt,
    checkedAt: cached?.checkedAt ?? snapshot.checkedAt,
    loading: true,
    stale: cached ? true : snapshot.stale,
    source: cached ? 'cache' : snapshot.source,
    error: null,
  })
  inflight = (async () => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 8_000)
    try {
      const url = liveNewsEndpoint(import.meta.env.VITE_LIVE_NEWS_ENDPOINT, import.meta.env.DEV)
      url.searchParams.set('limit', '40')
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error(`News wire returned HTTP ${response.status}.`)
      const payload = await response.json() as unknown
      const wire = parseLiveNewsResponse(payload, nowMs)
      const events = wire.events
      if (!events.length) throw new Error('News wire returned no publishable events.')
      const generatedAt = wire.generatedAt ?? new Date(nowMs).toISOString()
      writeCache(events, generatedAt, wire.checkedAt, wire.stale, nowMs)
      lastFailureAtMs = null
      return publish({
        events,
        generatedAt,
        checkedAt: wire.checkedAt,
        loading: false,
        stale: wire.stale,
        source: 'network',
        error: wire.stale ? 'Showing the latest saved edition.' : null,
      })
    } catch (error) {
      if (cached?.events.length) {
        return publish({ events: cached.events, generatedAt: cached.generatedAt, checkedAt: cached.checkedAt, loading: false, stale: true, source: 'cache', error: 'Showing the latest saved edition.' })
      }
      if (import.meta.env.DEV) {
        const checkedAt = new Date(nowMs).toISOString()
        return publish({ events: previewLiveNewsEvents(nowMs), generatedAt: checkedAt, checkedAt, loading: false, stale: false, source: 'preview', error: null })
      }
      lastFailureAtMs = nowMs
      // NOT error.message. That is the browser's string — a reader of The
      // Poplur Times was being shown the literal words "Failed to fetch"
      // under a LIVE WORLD WIRE masthead. The real message goes to the
      // console for us; the page says something a person can act on.
      console.warn('[liveNews] wire unavailable:', error instanceof Error ? error.message : error)
      return publish({ events: [], generatedAt: null, checkedAt: null, loading: false, stale: false, source: 'empty', error: 'The world wire is quiet — showing stories from your radius.' })
    } finally {
      window.clearTimeout(timeout)
      inflight = null
    }
  })()
  return inflight
}

export function useLiveNews() {
  const [current, setCurrent] = useState(snapshot)
  useEffect(() => {
    const unsubscribe = subscribe(setCurrent)
    void loadLiveNews(false)
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible' && navigator.onLine !== false) {
        void loadLiveNews(false)
      }
    }
    const interval = window.setInterval(refreshIfVisible, FOREGROUND_REFRESH_MS)
    document.addEventListener('visibilitychange', refreshIfVisible)
    window.addEventListener('online', refreshIfVisible)
    return () => {
      unsubscribe()
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshIfVisible)
      window.removeEventListener('online', refreshIfVisible)
    }
  }, [])
  const refresh = useCallback(() => loadLiveNews(true), [])
  return { ...current, refresh }
}
