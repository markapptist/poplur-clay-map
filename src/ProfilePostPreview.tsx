import { useCallback, useEffect, useState } from 'react'
import styles from './ProfileTwin.module.css'

/** A poster owns its readiness locally. In particular, a cached image must
 * not schedule a Profile-wide update from a new callback ref on every commit. */
export default function ProfilePostPreview({ src }: { src: string }) {
  const [ready, setReady] = useState(false)
  const [staticGone, setStaticGone] = useState(false)
  const attach = useCallback((node: HTMLImageElement | null) => {
    if (node) setReady(node.complete)
  }, [src])
  const finish = useCallback(() => setReady(true), [])

  useEffect(() => { setStaticGone(false) }, [src])
  useEffect(() => {
    if (!ready) return
    const timer = window.setTimeout(() => setStaticGone(true), 620)
    return () => window.clearTimeout(timer)
  }, [ready, src])

  return <>
    <img ref={attach}
      className={ready ? `${styles.tilePreview} ${styles.tilePreviewReady}` : styles.tilePreview}
      src={src} alt="" decoding="async" draggable={false} onLoad={finish} onError={finish} />
    {!staticGone && <span
      className={ready ? `${styles.tileStatic} ${styles.tileStaticOut}` : styles.tileStatic}
      aria-hidden="true" />}
  </>
}
