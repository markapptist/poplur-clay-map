import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { SideControlIconImage } from './SideControlIcon'
import styles from './PostReportDialog.module.css'

/** Confirm reporting someone else's pop — and, when `onBlock` is given, offer
 *  to block its poster from the same place (App Review 1.2: a way to flag
 *  content AND a way to block abusive users, both reachable from the content).
 *  A viewport-owned portal like PostDeleteDialog, so neither a transformed
 *  viewer nor its rails can move it; painted as a map glass window (Drop a
 *  Pop's anatomy), so the pop being reported shows through. */
export default function PostReportDialog({ onReport, onBlock, posterName, onCancel, dataId }: {
  onReport: () => void
  onBlock?: () => void
  /** Who posted it, as the Block button names them. */
  posterName?: string
  onCancel: () => void
  dataId: string
}) {
  const titleId = useId()
  const descriptionId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const close = useRef(onCancel); close.current = onCancel
  useEffect(() => {
    const previous = document.activeElement
    cancel.current?.focus({ preventScroll: true })
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); close.current()
      } else if (event.key === 'Tab') {
        const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
        const first = buttons[0], last = buttons[buttons.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', keyDown, true)
    return () => {
      document.removeEventListener('keydown', keyDown, true)
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])

  return createPortal(
    <div className={styles.overlay} data-post-report-overlay data-poplur-native-hit-region
      onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
      onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) onCancel() }}>
      <div ref={dialog} className={styles.dialog} role="dialog" aria-modal="true"
        aria-labelledby={titleId} aria-describedby={descriptionId} data-poplur-dialog={dataId}>
        <div className={styles.header}>
          <span className={styles.heroIcon} aria-hidden="true">
            <SideControlIconImage icon="global.block" displaySize={54} loading="eager" />
          </span>
          <div className={styles.heading}>
            <span className={styles.eyebrow}>Safety</span>
            <h2 id={titleId} className={styles.title}>{onBlock ? 'Report or block' : 'Report this pop?'}</h2>
            {posterName?.trim() && <div className={styles.subtitle}>A pop by {posterName.trim()}</div>}
          </div>
          <button type="button" className={styles.close} aria-label="Close without reporting" onClick={onCancel}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className={styles.body}>
          <p id={descriptionId} className={styles.panel}>
            Poplur reviews every report within 24 hours.<br />The person who posted it isn't told who reported it.
            {onBlock && <><br />Blocking removes their pops from your feed and map now, and tells Poplur.</>}
          </p>
          <button type="button" className={styles.report} onClick={onReport} data-report-pop="">Report pop</button>
          {onBlock && (
            <button type="button" className={styles.block} onClick={onBlock} data-block-poster="">
              Block {posterName?.trim() ? posterName.trim() : 'this account'}
            </button>
          )}
          <button ref={cancel} type="button" className={styles.cancel} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>, document.body,
  )
}
