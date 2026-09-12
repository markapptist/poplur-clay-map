import { useEffect, useRef, useState } from 'react'
import { openInPoplurBrowser } from './inAppBrowser'
import styles from './NewsPaper.module.css'
import { poplurResourcePool, type PoplurResourceLease } from './resourcePool'

/** Official post player: mounted only after a tap, one at a time, released offscreen. */
export default function NewsSourceVideo({ embedUrl, poster, sourceUrl, active }: {
  embedUrl: string; poster?: string; sourceUrl: string; active: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const lease = useRef<PoplurResourceLease | null>(null)
  const [playing, setPlaying] = useState(false)
  const [height, setHeight] = useState(460)
  useEffect(() => {
    if (!playing || !active) { lease.current?.release(); lease.current = null }
  }, [playing, active])
  useEffect(() => () => { lease.current?.release(); lease.current = null }, [])
  useEffect(() => {
    if (!active) setPlaying(false)
  }, [active])
  useEffect(() => {
    const stop = () => { lease.current?.release(); lease.current = null; setPlaying(false) }
    const hidden = () => { if (document.hidden) stop() }
    const native = (event: Event) => { if ((event as CustomEvent).detail?.active === false) stop() }
    const other = (event: Event) => { if ((event as CustomEvent).detail !== embedUrl) stop() }
    const observer = new IntersectionObserver(([entry]) => { if (!entry?.isIntersecting) stop() })
    if (host.current) observer.observe(host.current)
    window.addEventListener('poplur-news-video-play', other)
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('pagehide', stop)
    window.addEventListener('poplur-native-app-lifecycle', native)
    return () => { window.removeEventListener('pagehide', stop); window.removeEventListener('poplur-native-app-lifecycle', native); observer.disconnect(); window.removeEventListener('poplur-news-video-play', other); document.removeEventListener('visibilitychange', hidden) }
  }, [embedUrl])
  useEffect(() => {
    const resize = (event: MessageEvent) => {
      if (event.origin !== 'https://embed.bsky.app' || event.source !== frame.current?.contentWindow) return
      const next = Number(event.data?.height)
      if (Number.isFinite(next) && next >= 160 && next <= 1400) setHeight(next)
    }
    window.addEventListener('message', resize)
    return () => window.removeEventListener('message', resize)
  }, [])
  return <div ref={host} className={styles.sourceVideo}>
    {playing && active ? <>
      <iframe ref={frame} src={`${embedUrl}?id=poplur&colorMode=light`} title="Original source video on Bluesky" style={{ height }} allow="fullscreen" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" />
      <button type="button" onClick={() => setPlaying(false)}>Close video</button>
    </> : <button type="button" className={styles.videoPoster} onClick={() => {
      window.dispatchEvent(new CustomEvent('poplur-news-video-play', { detail: embedUrl }))
      lease.current?.release()
      lease.current = poplurResourcePool.acquire('media-decoder', `news-source:${embedUrl}`, { priority: 150, onRevoke: () => { lease.current = null; setPlaying(false) } })
      setPlaying(Boolean(lease.current))
    }} disabled={!active} aria-label="Play source video">
      {poster && <img src={poster} alt="" loading="lazy" />}
      <span>▶ Watch video</span>
    </button>}
    <button type="button" onClick={() => openInPoplurBrowser(sourceUrl)}>Open original on Bluesky ↗</button>
  </div>
}
