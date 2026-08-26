import { AvaturnSDK, type ExportAvatarResult } from '@avaturn/sdk'
import React, { useEffect, useRef, useState } from 'react'
import {
  avaturnEditorUrl,
  readSavedAvaturnAvatar,
  resolveSavedAvaturnAvatarUrl,
  saveAvaturnAvatar,
  type SavedAvaturnAvatar,
} from './avaturnAvatarStore'
import styles from './AvaturnWardrobe.module.css'

const configuredSubdomain = import.meta.env.VITE_AVATURN_SUBDOMAIN as string | undefined

export default function AvaturnWardrobe({ onUseClassic }: { onUseClassic: () => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const sdkRef = useRef<AvaturnSDK | null>(null)
  const [saved, setSaved] = useState<SavedAvaturnAvatar | null>(() => readSavedAvaturnAvatar())
  const [editing, setEditing] = useState(() => !readSavedAvaturnAvatar())
  const [status, setStatus] = useState('Opening fitted wardrobe…')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!editing) return
    const host = hostRef.current
    if (!host) return
    let disposed = false
    const sdk = new AvaturnSDK()
    sdkRef.current = sdk
    sdk.on('load', () => {
      if (!disposed) setStatus('Choose a body and clothes, then press Next to save')
    })
    sdk.on('export', (result: ExportAvatarResult) => {
      if (disposed) return
      setStatus('Saving fitted avatar…')
      void saveAvaturnAvatar(result).then(next => {
        if (disposed) return
        setSaved(next)
        setEditing(false)
        setStatus('Fitted avatar saved')
      }).catch(reason => {
        if (disposed) return
        setError(reason instanceof Error ? reason.message : 'Could not save the fitted avatar')
        setStatus('Export failed')
      })
    })
    sdk.on('error', event => {
      if (disposed) return
      setError(event.message || 'The fitted wardrobe could not load')
      setStatus('Wardrobe unavailable')
    })
    void sdk.init(host, {
      url: avaturnEditorUrl(configuredSubdomain),
      iframeClassName: styles.avaturnFrame,
    }).then(() => {
      if (!disposed) setStatus('Choose a body and clothes, then press Next to save')
    }).catch(reason => {
      if (disposed) return
      setError(reason instanceof Error ? reason.message : 'The fitted wardrobe could not load')
      setStatus('Wardrobe unavailable')
    })
    return () => {
      disposed = true
      sdk.destroy()
      sdkRef.current = null
      host.replaceChildren()
    }
  }, [editing])

  return (
    <section className={styles.surface} data-wardrobe-provider='avaturn'>
      <header className={styles.toolbar}>
        <div>
          <strong>Fitted wardrobe</strong>
          <small>{status}</small>
        </div>
        <div className={styles.actions}>
          {!editing && <button type='button' onClick={() => { setError(''); setEditing(true) }}>Change outfit</button>}
          <button type='button' onClick={onUseClassic}>Poplur Classic</button>
        </div>
      </header>

      {editing
        ? <div ref={hostRef} className={styles.sdkHost} aria-label='Fitted avatar and clothing editor' />
        : saved && <AvaturnAvatarPreview saved={saved} />}

      {error && <div className={styles.error} role='alert'>
        <strong>Could not open the fitted wardrobe.</strong>
        <span>{error}</span>
        <button type='button' onClick={() => { setError(''); setEditing(false) }}>Show saved avatar</button>
      </div>}

      {configuredSubdomain ? null : <p className={styles.demoNote}>Free demo is active. Add your Avaturn project subdomain to remove demo limits.</p>}
    </section>
  )
}

function AvaturnAvatarPreview({ saved }: { saved: SavedAvaturnAvatar }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let disposed = false
    let revokeUrl = ''
    void resolveSavedAvaturnAvatarUrl(saved).then(result => {
      if (disposed || !result) return
      if (result.revoke) revokeUrl = result.url
      setUrl(result.url)
    }).catch(reason => {
      if (!disposed) setError(reason instanceof Error ? reason.message : 'Could not restore the fitted avatar')
    })
    return () => {
      disposed = true
      if (revokeUrl) URL.revokeObjectURL(revokeUrl)
    }
  }, [saved])

  if (error) return <div className={styles.previewStatus} role='alert'>{error}</div>
  if (!url) return <div className={styles.previewStatus}>Loading fitted avatar…</div>
  return React.createElement('model-viewer', {
    src: url,
    alt: `${saved.gender} fitted Poplur avatar`,
    class: styles.avatarPreview,
    'camera-controls': true,
    'auto-rotate': true,
    'auto-rotate-delay': 900,
    'rotation-per-second': '12deg',
    'shadow-intensity': '0.65',
    'environment-image': 'neutral',
    'interaction-prompt': 'none',
  })
}
