import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import styles from './PostDeleteDialog.module.css'

/** Confirm reporting someone else's pop. The same viewport-owned shell as
 *  PostDeleteDialog, so neither a transformed viewer nor its rails can move it. */
export default function PostReportDialog({ onReport, onCancel, dataId }: {
  onReport: () => void
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
        <button type="button" className={styles.close} aria-label="Close without reporting" onClick={onCancel}>×</button>
        <h2 id={titleId}>Report this pop?</h2>
        <p id={descriptionId}>Poplur reviews every report.<br />The person who posted it isn't told who reported it.</p>
        <button type="button" className={styles.remove} onClick={onReport}>Report pop</button>
        <button ref={cancel} type="button" className={styles.keep} onClick={onCancel}>Cancel</button>
      </div>
    </div>, document.body,
  )
}
