import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { SideControlIconImage } from './SideControlIcon'
import styles from './PostDeleteDialog.module.css'

/** Viewport-owned confirmation: neither a transformed viewer nor its rails can position it. */
export default function PostDeleteDialog({ onDelete, onCancel, dataId }: {
  onDelete: () => void
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
    <div className={styles.overlay} data-post-delete-overlay data-poplur-native-hit-region
      onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
      onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) onCancel() }}>
      <div ref={dialog} className={styles.dialog} role="dialog" aria-modal="true"
        aria-labelledby={titleId} aria-describedby={descriptionId} data-poplur-dialog={dataId}>
        <button type="button" className={styles.close} aria-label="Keep post and close" onClick={onCancel}>×</button>
        <SideControlIconImage icon="profile.delete" displaySize={72} loading="eager" />
        <h2 id={titleId}>Delete this post?</h2>
        <p id={descriptionId}>It leaves your profile, Feed and Map.<br />This cannot be undone.</p>
        <button type="button" className={styles.remove} onClick={onDelete}>Delete post</button>
        <button ref={cancel} type="button" className={styles.keep} onClick={onCancel}>Keep it</button>
      </div>
    </div>, document.body,
  )
}
