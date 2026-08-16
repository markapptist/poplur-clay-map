import React from 'react'
import styles from './ComposerAIChat.module.css'

const IDEAS = ['Make this cinematic', 'Build a commercial', 'Add surreal VFX', 'Cut it like a music video']

export default function ComposerAIChat({
  media,
  prompt,
  onPromptChange,
  onGenerate,
  onUseOriginal,
}: {
  media: { kind: 'photo' | 'video'; src: string }
  prompt: string
  onPromptChange: (value: string) => void
  onGenerate: () => void
  onUseOriginal: () => void
}) {
  return (
    <section className={styles.chat} aria-label="Poplur AI post chat">
      <header className={styles.header}>
        <span className={styles.mark}>P</span>
        <span className={styles.identity}>
          <strong>poplur <b>AI</b></strong>
          <small><i /> CAPTURE ATTACHED</small>
        </span>
        <button type="button" aria-label="AI chat settings">•••</button>
      </header>

      <div className={styles.conversation}>
        <article className={styles.assistantMessage}>
          <span>P&nbsp;&nbsp;POPLUR AI</span>
          <p>I have your capture. What should I turn it into?</p>
        </article>

        <div className={styles.attachment}>
          {media.kind === 'video' ? (
            <video src={media.src} autoPlay muted loop playsInline preload="metadata" />
          ) : (
            <img src={media.src} alt="Capture attached to Poplur AI" />
          )}
          <span><b>{media.kind === 'video' ? 'YOUR RECORDING' : 'YOUR CAPTURE'}</b><small>Ready for generation</small></span>
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
          <button type="button" className={styles.addButton} aria-label="Add reference">+</button>
          <textarea
            value={prompt}
            maxLength={500}
            rows={2}
            placeholder="Message Poplur AI"
            aria-label="Message Poplur AI"
            onChange={event => onPromptChange(event.currentTarget.value)}
          />
          <button type="button" className={styles.sendButton} aria-label="Generate with Poplur AI" disabled={!prompt.trim()} onClick={onGenerate}>↑</button>
        </div>
        <div className={styles.modes}>
          <span>SMART</span><span>VFX AWARE</span>
          <button type="button" onClick={onUseOriginal}>Use original</button>
        </div>
      </div>
    </section>
  )
}
