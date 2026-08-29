import React from 'react'
import styles from './ComposerAIChat.module.css'
import BoundedPopupVideo from './BoundedPopupVideo'

const IDEAS = ['Make this cinematic', 'Build a commercial', 'Add surreal VFX', 'Cut it like a music video']

export default function ComposerAIChat({
  media,
  prompt,
  onPromptChange,
  onGenerate,
  onUseOriginal,
  poster,
  status,
  generating = false,
}: {
  media: { kind: 'photo' | 'video'; src: string }
  poster?: string | null
  prompt: string
  onPromptChange: (value: string) => void
  onGenerate: () => void
  onUseOriginal: () => void
  status?: string | null
  generating?: boolean
}) {
  return (
    <section className={styles.chat} aria-label="Poplur AI post chat">
      <header className={styles.header}>
        <span className={styles.mark}>P</span>
        <span className={styles.identity}>
          <strong>poplur <b>AI</b></strong>
          <small><i /> CAPTURE ATTACHED</small>
        </span>
      </header>

      <div className={styles.finishBar}>
        <span><b>FINISH CREATION</b><small>Keep your edit or give Poplur AI one clear direction.</small></span>
        <button type="button" disabled={generating} onClick={onUseOriginal}><b aria-hidden="true">✓</b> Use this edit</button>
      </div>

      <div className={styles.conversation}>
        <article className={styles.assistantMessage}>
          <span>P&nbsp;&nbsp;POPLUR AI</span>
          <p>{media.kind === 'photo'
            ? 'I’ll use your photo and direction to make an AI edit. Keep this edit, or use the generated result.'
            : poster
              ? 'I’ll use a frame from your recording and your direction to make an AI edit. Keep your recording, or use the generated result.'
              : 'I’ll use your direction to make an AI image while your recording stays attached.'}</p>
        </article>

        {status && <p className={styles.status} role="status">{status}</p>}

        <div className={styles.attachment}>
          {media.kind === 'video' ? (
            <BoundedPopupVideo
              src={media.src}
              poster={poster ?? undefined}
              alt="Your recording attached to Poplur AI"
              disablePictureInPicture
            />
          ) : (
            <img src={media.src} alt="Capture attached to Poplur AI" />
          )}
          <span><b>{media.kind === 'video' ? 'YOUR RECORDING' : 'YOUR CAPTURE'}</b><small>{media.kind === 'photo' ? 'Will be sent securely for this edit' : poster ? 'One bounded frame will guide this edit' : 'Your recording remains attached'}</small></span>
          <em>✓</em>
        </div>

        <div className={styles.ideas}>
          {IDEAS.map(idea => (
            <button type="button" key={idea} onClick={() => onPromptChange(idea)}>{idea}</button>
          ))}
        </div>
      </div>

      <div className={styles.composer}>
        <div className={styles.inputRow}>
          <textarea
            value={prompt}
            maxLength={500}
            rows={2}
            placeholder="Message Poplur AI"
            aria-label="Message Poplur AI"
            onChange={event => onPromptChange(event.currentTarget.value)}
          />
          <button type="button" className={styles.sendButton} aria-label="Generate with Poplur AI" disabled={!prompt.trim() || generating} onClick={onGenerate}>{generating ? '…' : '↑'}</button>
        </div>
        <div className={styles.modes}>
          <span>SMART</span><span>VFX AWARE</span>
          <small>AI changes are optional</small>
        </div>
      </div>
    </section>
  )
}
