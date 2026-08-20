// ── SoundCloud's player, driven from the handheld ───────────────────────────
//
// An artist's audio is not ours to fetch. Pulling their stream into Web Audio
// would be against SoundCloud's terms, and it would also strip the play count
// and the link back to them, which is the entire reason an underground artist
// puts a track up in the first place. So their tracks play in SoundCloud's own
// embedded player, and the iPod drives that player over the Widget API.
//
// This costs the handheld three things, and they are worth naming: the audio is
// not in our graph, so it cannot go through the mute gate as a gain node (we
// pause it instead), it cannot be mixed into an exported video, and the
// position has to be asked for rather than read off a clock. Uploaded tracks
// have none of those limits, which is why 'upload' is the real path and this is
// the interim one.

const API_SRC = 'https://w.soundcloud.com/player/api.js'

interface SCWidget {
  play(): void
  pause(): void
  setVolume(v: number): void
  seekTo(ms: number): void
  getDuration(cb: (ms: number) => void): void
  getPosition(cb: (ms: number) => void): void
  bind(event: string, cb: () => void): void
  unbind(event: string): void
}

interface SCApi {
  Widget: ((el: HTMLIFrameElement) => SCWidget) & {
    Events: { READY: string; PLAY: string; PAUSE: string; FINISH: string; PLAY_PROGRESS: string }
  }
}

type SCWindow = Window & { SC?: SCApi }

let pending: Promise<SCApi | null> | null = null

/**
 * The Widget API script, once. Resolves null rather than throwing when it
 * cannot load — offline, or a WebView that blocks it. A null here does not
 * break playback: the iframe still autoplays, it just cannot be paused from
 * the wheel, and the caller says so on screen instead of looking broken.
 */
export function loadWidgetApi(): Promise<SCApi | null> {
  if (pending) return pending
  pending = new Promise<SCApi | null>(resolve => {
    const w = window as SCWindow
    if (w.SC?.Widget) { resolve(w.SC); return }
    const script = document.createElement('script')
    script.src = API_SRC
    script.async = true
    script.onload = () => resolve((window as SCWindow).SC ?? null)
    script.onerror = () => resolve(null)
    document.head.appendChild(script)
  })
  return pending
}

/** The embed URL for a track. Chrome stripped back so the iPod screen stays
 *  the iPod screen — but the artist's name and artwork stay, deliberately. */
export function widgetSrc(permalink: string, opts: { autoPlay?: boolean } = {}) {
  const params = new URLSearchParams({
    url: permalink,
    auto_play: String(opts.autoPlay ?? true),
    hide_related: 'true',
    show_comments: 'false',
    show_reposts: 'false',
    show_teaser: 'false',
    visual: 'false',
    color: '#111111',
  })
  return `https://w.soundcloud.com/player/?${params.toString()}`
}

/** Bind a widget to an iframe, or null if the API never arrived. */
export async function attachWidget(iframe: HTMLIFrameElement): Promise<SCWidget | null> {
  const api = await loadWidgetApi()
  if (!api?.Widget) return null
  try { return api.Widget(iframe) } catch { return null }
}

export const SC_EVENTS = {
  READY: 'ready',
  PLAY: 'play',
  PAUSE: 'pause',
  FINISH: 'finish',
} as const

export type { SCWidget }
