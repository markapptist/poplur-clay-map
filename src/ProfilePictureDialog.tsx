import { useEffect, useId, useRef } from 'react'
import { SideControlIconImage } from './SideControlIcon'
import ProfileCloseButton from './ProfileCloseButton'
import clay from './ClayMap.module.css'
import styles from './ProfilePictureDialog.module.css'

/** The same window and molded controls as Map → Drop a Pop. */
export default function ProfilePictureDialog({ hasPicture, busy, error, onTake, onRemove, onClose }: {
  hasPicture: boolean
  busy: boolean
  error: string | null
  onTake: () => void
  onRemove: () => void
  onClose: () => void
}) {
  const titleId = useId()
  const dialog = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    dialog.current?.focus({ preventScroll: true })
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])

  return <div className={styles.overlay} data-profile-picture-menu
    onClick={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section ref={dialog} className={`${clay.composeBubble} ${styles.dialog}`}
      role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy}
      data-poplur-dialog="profile-picture" tabIndex={-1}
      onKeyDown={event => {
        event.stopPropagation()
        if (event.key === 'Escape') { event.preventDefault(); if (!busy) onClose() }
        if (event.key !== 'Tab') return
        const controls = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
        const first = controls[0], last = controls[controls.length - 1]
        if (!first) event.preventDefault()
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
          event.preventDefault(); last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }}>
      <header className={clay.composeHeader}>
        <span className={clay.composeHeroIcon} aria-hidden="true">
          <SideControlIconImage icon="profile.camera" displaySize={58} loading="eager" />
        </span>
        <div className={clay.composeHeadingCopy}>
          <span className={clay.composeEyebrow}>Your profile</span>
          <h2 id={titleId} className={`${clay.composeTitle} ${styles.title}`}>Profile picture</h2>
          <div className={clay.composeSubtitle}>Make it yours</div>
        </div>
        <ProfileCloseButton label="Close" disabled={busy} onClose={onClose} />
      </header>
      <div className={`${clay.composeBody} ${styles.body}`}>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <button type="button" className={clay.composeDrop} disabled={busy} onClick={onTake}>
          <SideControlIconImage icon="profile.camera" displaySize={48} loading="eager" />
          <span className={clay.composeDropCopy}><strong>Take a new one</strong><small>Record a profile selfie</small></span>
        </button>
        {hasPicture && <button type="button" className={`${clay.composeCancel} ${styles.remove}`} disabled={busy} onClick={onRemove}>
          <SideControlIconImage icon="profile.delete" displaySize={40} loading="eager" />
          <span>{busy ? 'Removing your picture…' : 'Remove picture'}</span>
        </button>}
      </div>
    </section>
  </div>
}
