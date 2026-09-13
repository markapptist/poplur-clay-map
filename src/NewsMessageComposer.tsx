import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComposerMedia } from './PostComposer'
import { setPendingMapPost } from './cameraStore'
import { MESSAGE_MAX } from './newsMessages'
import { newsMessageDraft } from './newsMessageDraft'
import ShellOverlayPortal from './ShellOverlayPortal'
import { SideControlIconImage } from './SideControlIcon'
import clay from './ClayMap.module.css'
import styles from './NewsMessageComposer.module.css'

export default function NewsMessageComposer({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const [body, setBody] = useState('')
  const [attachment, setAttachment] = useState<ComposerMedia | null>(null)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const reader = useRef<FileReader | null>(null)
  const choosing = useRef(false)
  const overlay = useRef<HTMLDivElement | null>(null)
  const returnFocus = useRef(typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null)
  const fitViewport = useCallback(() => {
    const viewport = window.visualViewport
    overlay.current?.style.setProperty('--news-compose-height', `${viewport?.height ?? window.innerHeight}px`)
    overlay.current?.style.setProperty('--news-compose-top', `${viewport?.offsetTop ?? 0}px`)
  }, [])
  const mountOverlay = useCallback((node: HTMLDivElement | null) => {
    overlay.current = node
    if (node) fitViewport()
  }, [fitViewport])
  const mountDialog = useCallback((node: HTMLElement | null) => {
    node?.focus({ preventScroll: true })
  }, [])
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('poplur-news-composing', { detail: true }))
    window.visualViewport?.addEventListener('resize', fitViewport)
    window.visualViewport?.addEventListener('scroll', fitViewport)
    window.addEventListener('resize', fitViewport)
    return () => {
      reader.current?.abort()
      window.visualViewport?.removeEventListener('resize', fitViewport)
      window.visualViewport?.removeEventListener('scroll', fitViewport)
      window.removeEventListener('resize', fitViewport)
      window.dispatchEvent(new CustomEvent('poplur-news-composing', { detail: false }))
      returnFocus.current?.focus?.({ preventScroll: true })
    }
  }, [fitViewport])
  const attach = (file?: File) => {
    reader.current?.abort()
    setBusy(false)
    if (!file) return
    if (!/^(image\/(jpeg|png|webp|heic|heif)|video\/(mp4|quicktime|webm))$/.test(file.type)) {
      setError('Choose a JPG, PNG, WebP or HEIC photo or an MP4, MOV, WebM video.'); return
    }
    if (file.size > 25 * 1024 * 1024) { setError('Choose content smaller than 25 MB.'); return }
    setBusy(true); setError('')
    const next = new FileReader(); reader.current = next
    next.onload = () => {
      if (reader.current !== next) return
      setAttachment({ kind: file.type.startsWith('video/') ? 'video' : 'photo', src: String(next.result) })
      setFileName(file.name); setBusy(false)
    }
    next.onerror = () => { if (reader.current === next) { setError('Could not read this file. Try another.'); setBusy(false) } }
    next.readAsDataURL(file)
  }
  const chooseLocation = () => {
    if (choosing.current || busy) return
    try {
      choosing.current = true
      setPendingMapPost(newsMessageDraft(body, attachment, channelId))
      window.dispatchEvent(new CustomEvent('poplur-pick-spot'))
      onClose()
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not prepare your message.'); choosing.current = false }
  }
  return <ShellOverlayPortal><div className={styles.overlay} ref={mountOverlay}>
    <button type="button" className={clay.composeDismissLayer} tabIndex={-1} aria-label="Dismiss New Pop Message" onClick={onClose} />
    <section className={`${clay.composeBubble} ${styles.dialog}`} role="dialog" aria-modal="true" aria-label="New Pop Message"
      tabIndex={-1} ref={mountDialog}
      onKeyDown={event => {
        event.stopPropagation()
        if (event.key === 'Escape') { event.preventDefault(); onClose() }
        if (event.key !== 'Tab') return
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, input, [tabindex="0"]')]
        const first = controls[0], last = controls[controls.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
          event.preventDefault(); last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }}>
      <header className={clay.composeHeader}>
        <span className={clay.composeHeroIcon} aria-hidden="true"><SideControlIconImage icon="map.news" displaySize={58} loading="eager" /></span>
        <div className={clay.composeHeadingCopy}>
          <span className={clay.composeEyebrow}>Poplur News</span>
          <div className={clay.composeTitle}>New Pop Message</div>
          <div className={clay.composeSubtitle}>What’s happening?</div>
        </div>
        <button type="button" className={clay.composeClose} aria-label="Close New Pop Message" onClick={onClose}>×</button>
      </header>
      <div className={clay.composeBody}>
        <section className={clay.composeMessagePanel}>
          <label className={clay.composeSectionLabel} htmlFor="news-pop-message">Your message</label>
          <textarea id="news-pop-message" className={`${clay.composeMessage} ${styles.message}`} value={body} maxLength={MESSAGE_MAX} rows={4}
            placeholder="Write your pop… #hashtags welcome" onChange={event => setBody(event.target.value)} />
          <div className={clay.composeMessageHint}><span>Share with people on the map</span><span className={clay.composeCount}>{body.length}/{MESSAGE_MAX}</span></div>
        </section>
        {attachment && <div className={styles.attachment}>
          {attachment.kind === 'photo' ? <img src={attachment.src} alt="Your attachment" /> : <video src={attachment.src} controls playsInline preload="metadata" />}
          <span>{fileName}</span><button type="button" className={clay.composeCancel} onClick={() => { setAttachment(null); setFileName('') }}>Remove content</button>
        </div>}
        <label className={`${clay.composeDirections} ${styles.attach}`}>
          <SideControlIconImage icon="profile.camera" displaySize={36} />
          <span><strong>{attachment ? 'Replace content' : 'Add photo or video'}</strong><small>Optional · Up to 25 MB</small></span>
          <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/webm" onChange={event => { attach(event.target.files?.[0]); event.target.value = '' }} />
        </label>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <p className={styles.next}>Next, choose your spot and radius.</p>
        <div className={clay.composeActions}>
          <button type="button" className={clay.composeCancel} onClick={onClose}><span className={clay.composeCancelMark} aria-hidden="true">×</span>Cancel</button>
          <button type="button" className={clay.composeDrop} disabled={!body.trim() || busy} onClick={chooseLocation}>
            <SideControlIconImage icon="map.locate" displaySize={48} />
            <span className={clay.composeDropCopy}><strong>{busy ? 'Preparing content…' : 'Choose spot on map'}</strong><small>Review before posting</small></span>
          </button>
        </div>
      </div>
    </section></div></ShellOverlayPortal>
}
