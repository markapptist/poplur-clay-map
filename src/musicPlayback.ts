/**
 * One app-wide answer to “is music audible right now?”.
 *
 * Poplur spans the Home document and the embedded Map document, while its
 * music comes from both DOM media (Feed/Studio) and WebAudio (iPod/Radio).
 * Keeping the signal here lets the navigator react to the actual playback
 * edge instead of guessing from which screen happens to be open.
 */

export interface MusicPlaybackSnapshot {
  playing: boolean
  /** Diagnostic source names. Consumers should key behavior from `playing`. */
  sources: readonly string[]
  changedAt: number
}

const CHANNEL = 'poplur.musicPlayback.v1'
const documentId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `music-${Date.now()}-${Math.random().toString(36).slice(2)}`

const localSources = new Set<string>()
const remoteSources = new Map<string, Set<string>>()
const remoteDocumentForWindow = new WeakMap<object, string>()
const listeners = new Set<() => void>()
let snapshot: MusicPlaybackSnapshot = Object.freeze({
  playing: false,
  sources: Object.freeze([]),
  changedAt: 0,
})

type MusicPlaybackMessage = {
  type: typeof CHANNEL
  documentId: string
  source: string
  playing: boolean
}

function isMessage(value: unknown): value is MusicPlaybackMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<MusicPlaybackMessage>
  return message.type === CHANNEL
    && typeof message.documentId === 'string'
    && typeof message.source === 'string'
    && typeof message.playing === 'boolean'
}

function refreshSnapshot() {
  const nextSources = [
    ...Array.from(localSources, source => `local:${source}`),
    ...Array.from(remoteSources, ([remoteDocument, sources]) => (
      Array.from(sources, source => `${remoteDocument}:${source}`)
    )).flat(),
  ].sort()
  const same = nextSources.length === snapshot.sources.length
    && nextSources.every((source, index) => source === snapshot.sources[index])
  if (same) return
  snapshot = Object.freeze({
    playing: nextSources.length > 0,
    sources: Object.freeze(nextSources),
    changedAt: Date.now(),
  })
  listeners.forEach(listener => listener())
}

function peers(): Window[] {
  if (typeof window === 'undefined') return []
  const result: Window[] = []
  try {
    if (window.parent && window.parent !== window) result.push(window.parent)
  } catch { /* cross-origin parent */ }
  try {
    if (window.top && window.top !== window && window.top !== window.parent) result.push(window.top)
  } catch { /* cross-origin top */ }
  return result
}

function broadcast(source: string, playing: boolean) {
  const message: MusicPlaybackMessage = { type: CHANNEL, documentId, source, playing }
  for (const peer of peers()) {
    try { peer.postMessage(message, '*') } catch { /* a frame disappeared */ }
  }
}

/** Report an actual music source. Calls are idempotent. */
export function setMusicPlayback(source: string, playing: boolean): void {
  if (!source) return
  const changed = playing ? !localSources.has(source) : localSources.has(source)
  if (!changed) return
  if (playing) localSources.add(source)
  else localSources.delete(source)
  refreshSnapshot()
  broadcast(source, playing)
}

export function getMusicPlaybackSnapshot(): MusicPlaybackSnapshot {
  return snapshot
}

export function subscribeMusicPlayback(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function clearLocalSources() {
  for (const source of localSources) broadcast(source, false)
  localSources.clear()
  refreshSnapshot()
}

if (typeof window !== 'undefined') {
  const onMessage = (event: MessageEvent) => {
    if (!isMessage(event.data) || event.data.documentId === documentId) return
    const { documentId: remoteDocument, source, playing } = event.data
    if (event.source && typeof event.source === 'object') {
      const priorDocument = remoteDocumentForWindow.get(event.source)
      if (priorDocument && priorDocument !== remoteDocument) {
        remoteSources.delete(priorDocument)
      }
      remoteDocumentForWindow.set(event.source, remoteDocument)
    }
    // Every document announces itself, even while silent. That replaces a
    // stale source set if an iframe was killed before pagehide could run.
    if (source === '__document__') {
      refreshSnapshot()
      return
    }
    let sources = remoteSources.get(remoteDocument)
    if (!sources) {
      if (!playing) return
      sources = new Set()
      remoteSources.set(remoteDocument, sources)
    }
    if (playing) sources.add(source)
    else sources.delete(source)
    if (sources.size === 0) remoteSources.delete(remoteDocument)
    refreshSnapshot()
  }

  // Explicitly tagged DOM audio/video covers Music Feed and Studio takes.
  // Ordinary voiced clips are not music. Detached Radio elements and WebAudio
  // iPod/Studio engines report explicitly through setMusicPlayback instead.
  const syncMedia = (media: HTMLMediaElement) => {
    // Opt-in is intentional. A voiced Food/Sports/Comedy clip is audible
    // media, but it is not music and must never arm the disco navigator.
    const source = declaredMusicSource(media)
    if (!source) return
    // Camera and FaceTime streams are conversation/capture, not music. Their
    // elements can be unmuted, so srcObject is the reliable distinction.
    const audible = media.srcObject == null
      && !media.paused
      && !media.ended
      && !media.muted
      && media.volume > 0
      && media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    setMusicPlayback(source, audible)
  }
  const onMediaState = (event: Event) => {
    if (event.target instanceof HTMLMediaElement) syncMedia(event.target)
  }
  const mediaEvents = ['playing', 'pause', 'ended', 'emptied', 'volumechange'] as const

  window.addEventListener('message', onMessage)
  mediaEvents.forEach(type => document.addEventListener(type, onMediaState, true))
  window.addEventListener('pagehide', clearLocalSources)
  broadcast('__document__', false)

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      clearLocalSources()
      window.removeEventListener('message', onMessage)
      mediaEvents.forEach(type => document.removeEventListener(type, onMediaState, true))
      window.removeEventListener('pagehide', clearLocalSources)
    })
  }
}

/** Only explicitly musical media may contribute to the disco signal. */
export function declaredMusicSource(media: Pick<HTMLMediaElement, 'dataset'>): string | null {
  return media.dataset.poplurMusic?.trim() || null
}
