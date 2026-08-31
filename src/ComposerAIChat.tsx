import React from 'react'
import styles from './ComposerAIChat.module.css'
import BoundedPopupVideo from './BoundedPopupVideo'

const PHOTO_IDEAS = ['Cinematic light', 'Campaign polish', 'Surreal scene']
const VIDEO_IDEAS = ['Cinematic cover', 'Campaign cover', 'Surreal cover']

export default function ComposerAIChat({
  media,
  prompt,
  onPromptChange,
  onGenerate,
  onUseOriginal,
  onUseCandidate,
  onEditTools,
  candidate,
  poster,
  mediaFilter,
  aiSourceReady = true,
  status,
  error,
  generating = false,
}: {
  media: { kind: 'photo' | 'video'; src: string }
  candidate?: string | null
  poster?: string | null
  mediaFilter?: string
  aiSourceReady?: boolean
  prompt: string
  onPromptChange: (value: string) => void
  onGenerate: () => void
  onUseOriginal: () => void
  onUseCandidate: () => void
  onEditTools: () => void
  status?: string | null
  error?: string | null
  generating?: boolean
}) {
  const ideas = media.kind === 'video' ? VIDEO_IDEAS : PHOTO_IDEAS
  const mediaLabel = media.kind === 'video' ? 'Original recording' : 'Original photo'
  const candidateActionRef = React.useRef<HTMLButtonElement>(null)
  const previousCandidateRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (candidate && candidate !== previousCandidateRef.current) {
      candidateActionRef.current?.focus()
    }
    previousCandidateRef.current = candidate ?? null
  }, [candidate])

  return (
    <section
      className={styles.chat}
      aria-labelledby="poplur-ai-title"
      aria-busy={generating}
      data-ai-state={generating ? 'generating' : candidate ? 'candidate' : error ? 'error' : 'choose'}
    >
      <header className={styles.header}>
        <span className={styles.mark} aria-hidden="true">P</span>
        <span className={styles.heading}>
          <small>CHOOSE YOUR VERSION</small>
          <strong id="poplur-ai-title">Create your pop</strong>
          <span>Keep the original or make one optional AI edit.</span>
        </span>
      </header>

      <div className={`${styles.mediaRow} ${candidate ? styles.mediaRowCompare : ''}`}>
        <figure>
          <span className={styles.mediaVisual} style={mediaFilter ? { filter: mediaFilter } : undefined}>
            {media.kind === 'video' ? (
              <BoundedPopupVideo
                src={media.src}
                poster={poster ?? undefined}
                alt={mediaLabel}
                disablePictureInPicture
              />
            ) : (
              <img src={media.src} alt={mediaLabel} />
            )}
          </span>
          <figcaption><b>ORIGINAL</b><span>{media.kind === 'video' ? 'Your recording' : 'Your photo'}</span></figcaption>
        </figure>
        {candidate && (
          <figure className={styles.candidate}>
            <span className={styles.mediaVisual} style={mediaFilter ? { filter: mediaFilter } : undefined}>
              <img src={candidate} alt="Poplur AI version" />
            </span>
            <figcaption><b>AI VERSION</b><span>Ready to choose</span></figcaption>
          </figure>
        )}
      </div>

      {candidate ? (
        <div className={styles.decision}>
          <p>Nothing changes until you choose.</p>
          <button ref={candidateActionRef} type="button" className={styles.primary} onClick={onUseCandidate}>
            <span aria-hidden="true">✓</span> Use AI version
          </button>
          <button type="button" className={styles.secondary} onClick={onUseOriginal}>Keep original</button>
          <button type="button" className={styles.textButton} disabled={generating} onClick={onGenerate}>Generate another</button>
        </div>
      ) : (
        <>
          <button type="button" className={styles.originalAction} disabled={generating} onClick={onUseOriginal}>
            <span aria-hidden="true">✓</span>
            <span><b>Use original</b><small>Continue without AI</small></span>
            <i aria-hidden="true">→</i>
          </button>

          <div className={styles.aiControls}>
            <span className={styles.sectionLabel}>EDIT WITH POPLUR AI</span>
            <p>{media.kind === 'video'
              ? 'Describe a new image made from one frame of this recording.'
              : 'Describe one change. You will preview it before using it.'}</p>
            <div className={styles.ideas} aria-label="AI edit ideas">
              {ideas.map(idea => (
                <button type="button" key={idea} disabled={generating} onClick={() => onPromptChange(idea)}>{idea}</button>
              ))}
            </div>
            <label className={styles.prompt}>
              <span className={styles.srOnly}>Describe your Poplur AI edit</span>
              <textarea
                value={prompt}
                maxLength={500}
                rows={3}
                placeholder="Describe your edit…"
                aria-label="Describe your Poplur AI edit"
                disabled={generating}
                onChange={event => onPromptChange(event.currentTarget.value)}
              />
            </label>
            <button
              type="button"
              className={styles.generate}
              disabled={!prompt.trim() || generating || !aiSourceReady}
              onClick={onGenerate}
            >
              <span aria-hidden="true">✦</span>
              {generating
                ? 'Creating your preview…'
                : !aiSourceReady
                  ? 'Preparing video frame…'
                  : error
                    ? 'Try AI again'
                    : 'Generate AI preview'}
            </button>
          </div>
        </>
      )}

      <div className={styles.liveRegion} aria-live="polite" aria-atomic="true">
        {!aiSourceReady && media.kind === 'video' && !candidate && (
          <p className={styles.status} role="status">Preparing a safe frame from your recording…</p>
        )}
        {status && <p className={styles.status} role="status">{status}</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>

      <button type="button" className={styles.editTools} disabled={generating} onClick={onEditTools}>
        Filters, trim &amp; VFX <span aria-hidden="true">›</span>
      </button>
    </section>
  )
}
