import { useEffect, useRef, useState } from 'react'
import type { ComposerMedia } from './PostComposer'
import { setPendingMapPost } from './cameraStore'
import { MESSAGE_MAX } from './newsMessages'
import { newsMessageDraft } from './newsMessageDraft'
import ShellOverlayPortal from './ShellOverlayPortal'
import styles from './NewsMessageComposer.module.css'

export default function NewsMessageComposer({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const [body, setBody] = useState('')
  const [attachment, setAttachment] = useState<ComposerMedia | null>(null)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const reader = useRef<FileReader | null>(null)
  const choosing = useRef(false)
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('poplur-news-composing', { detail: true }))
    return () => { reader.current?.abort(); window.dispatchEvent(new CustomEvent('poplur-news-composing', { detail: false })) }
  }, [])
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
  return <ShellOverlayPortal><section className={styles.screen} role="dialog" aria-modal="true" aria-label="New Pop Message"
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }}>
    <header><button type="button" onClick={onClose}>Cancel</button><strong>New Pop Message</strong></header>
    <main>
      <h1>What’s happening?</h1>
      <p>Share a message with people on the map. Add a photo or video if you like.</p>
      <label className={styles.label}>Your message<textarea autoFocus value={body} maxLength={MESSAGE_MAX} rows={7}
        placeholder="Write your pop… #hashtags welcome" onChange={event => setBody(event.target.value)} /></label>
      <small className={styles.count}>{body.length}/{MESSAGE_MAX}</small>
      {attachment && <div className={styles.attachment}>
        {attachment.kind === 'photo' ? <img src={attachment.src} alt="Your attachment" /> : <video src={attachment.src} controls playsInline preload="metadata" />}
        <span>{fileName}</span><button type="button" onClick={() => { setAttachment(null); setFileName('') }}>Remove content</button>
      </div>}
      <label className={styles.attach}>{attachment ? 'Replace content' : 'Add photo or video'}
        <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/webm" onChange={event => { attach(event.target.files?.[0]); event.target.value = '' }} />
      </label>
      <small>Optional · One photo or video, up to 25 MB</small>
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </main>
    <footer><p>Next, choose your spot and radius. You’ll review everything before posting.</p>
      <button type="button" disabled={!body.trim() || busy} onClick={chooseLocation}>{busy ? 'Preparing content…' : 'Choose spot on map'}</button>
    </footer>
  </section></ShellOverlayPortal>
}
