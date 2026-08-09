import React, { useEffect, useRef, useState } from 'react'
import styles from './AIChatScreen.module.css'
import { playPop } from './pop'
import { takePendingAICompose } from './cameraStore'

type ChatMessage = {
  id: number
  role: 'user' | 'assistant'
  text: string
  attachment?: string
}

const SUGGESTIONS = [
  { label: 'Make this cinematic', icon: 'FILM' },
  { label: 'Create commercial', icon: 'AD' },
  { label: 'Make funny', icon: 'LOL' },
  { label: 'Cartoon style', icon: 'TOON' },
  { label: '90s TV', icon: 'TV' },
  { label: 'Add music', icon: 'MIX' },
  { label: 'Translate', icon: 'A/Z' },
  { label: 'Make viral', icon: 'UP' },
  { label: 'Brainstorm', icon: 'IDEA' },
]

function assistantReply(prompt: string): string {
  const lower = prompt.toLowerCase()
  if (lower.includes('cinematic')) return 'I can give it a cinematic grade, wider framing, and a slower final beat. Add a photo or video when you are ready.'
  if (lower.includes('commercial')) return 'What are we advertising, and should it feel playful, polished, or urgent?'
  if (lower.includes('translate')) return 'Send the words or media and tell me the language you want.'
  if (lower.includes('music')) return 'I can build the cut around a track. Upload the clip and describe the energy.'
  if (lower.includes('brainstorm')) return 'Tell me the place, audience, and feeling. I will turn that into a few strong directions.'
  return 'Got it. Add any media you want me to work with, or tell me one more detail about the result.'
}

// onClose stays in the contract for hosts that need it; the cube (HoldMenu's
// universal back) is what actually dismisses this subscreen.
export default function AIChatScreen({ onClose: _onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [attachment, setAttachment] = useState<{ name: string; url?: string } | null>(null)
  const [thinking, setThinking] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [smartMode, setSmartMode] = useState(true)
  const [searchMode, setSearchMode] = useState(false)
  const nextId = useRef(1)
  const replyTimer = useRef<number | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const conversation = useRef<HTMLDivElement | null>(null)
  const objectUrls = useRef(new Set<string>())
  const layoutOrigin = useRef({ x: 0, y: 0 })

  useEffect(() => () => {
    if (replyTimer.current) window.clearTimeout(replyTimer.current)
    objectUrls.current.forEach(url => URL.revokeObjectURL(url))
    objectUrls.current.clear()
  }, [])

  // A capture handed over from the composer's "Generate in Poplur AI".
  //
  // The composer stashes it module-side and closes, so by the time this screen
  // mounts the only trace is that store — read it once, on open. Reading also
  // clears it, so reopening the chat later does not re-attach a shot the user
  // already dealt with.
  //
  // The URL is NOT registered in objectUrls: this blob belongs to the camera
  // roll, which still holds the capture, and revoking it on unmount would kill
  // the roll's own thumbnail too. Only URLs minted in here are ours to revoke.
  useEffect(() => {
    const job = takePendingAICompose()
    if (!job) return
    setAttachment({ name: job.media.kind === 'video' ? 'Your recording' : 'Your capture', url: job.media.src })
    // Their words survive the trip. An empty prompt is fine — arriving with the
    // picture and nothing typed is a legitimate way to start.
    if (job.prompt.trim()) setInput(job.prompt)
  }, [])

  useEffect(() => {
    conversation.current?.scrollTo({ top: conversation.current.scrollHeight, behavior: 'smooth' })
  }, [messages, thinking])

  useEffect(() => {
    const viewport = window.visualViewport
    const holdHomeLayout = () => window.scrollTo(layoutOrigin.current.x, layoutOrigin.current.y)
    viewport?.addEventListener('resize', holdHomeLayout)
    return () => viewport?.removeEventListener('resize', holdHomeLayout)
  }, [])

  const send = (value = input) => {
    const text = value.trim()
    if (!text && !attachment) return
    playPop()
    const userMessage: ChatMessage = {
      id: nextId.current++,
      role: 'user',
      text: text || attachment?.name || 'Attachment',
      attachment: attachment?.url,
    }
    setMessages(current => [...current, userMessage])
    setInput('')
    setAttachment(null)
    setThinking(true)
    if (replyTimer.current) window.clearTimeout(replyTimer.current)
    replyTimer.current = window.setTimeout(() => {
      setMessages(current => [
        ...current,
        {
          id: nextId.current++,
          role: 'assistant',
          text: assistantReply(text || attachment?.name || ''),
        },
      ])
      setThinking(false)
      replyTimer.current = null
    }, 650)
  }

  return (
    <section className={styles.screen} aria-label="Poplur AI chat">
      <div className={styles.confetti} aria-hidden="true" />
      <header className={styles.header}>
        {/* No ‹ back — the cube closes this subscreen like every other. */}
        <div className={styles.identity}>
          <span className={styles.mark} aria-hidden="true">P</span>
          <span>
            <strong>poplur <b>AI</b></strong>
            <small><i /> READY TO CREATE</small>
          </span>
        </div>
        <button
          type="button"
          className={styles.settings}
          aria-label="AI chat settings"
          aria-expanded={settingsOpen}
          onClick={() => { playPop(); setSettingsOpen(value => !value) }}
        >
          •••
        </button>
      </header>

      {settingsOpen && (
        <div className={styles.settingsPanel} role="dialog" aria-label="AI chat settings">
          <label>
            <span>Smart mode</span>
            <input
              type="checkbox"
              checked={smartMode}
              onChange={event => setSmartMode(event.currentTarget.checked)}
            />
          </label>
          <label>
            <span>Search mode</span>
            <input
              type="checkbox"
              checked={searchMode}
              onChange={event => setSearchMode(event.currentTarget.checked)}
            />
          </label>
        </div>
      )}

      <div className={styles.conversation} ref={conversation}>
        {messages.length === 0 && (
          <div className={styles.welcome}>
            <span className={styles.eyebrow}>POPLUR CREATIVE AI</span>
            <span className={styles.sparkle}>P</span>
            <h1>Make something<br />people stop for.</h1>
            <p>Start with an idea, or add a photo or video.</p>
            <div className={styles.suggestions}>
              {SUGGESTIONS.map(suggestion => (
                <button
                  type="button"
                  key={suggestion.label}
                  onClick={() => send(suggestion.label)}
                >
                  <b aria-hidden="true">{suggestion.icon}</b>
                  <span>{suggestion.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(message => (
          <article
            className={message.role === 'user' ? styles.userMessage : styles.assistantMessage}
            key={message.id}
          >
            <span className={styles.messageAuthor}>{message.role === 'assistant' ? 'P  POPLUR AI' : 'YOU'}</span>
            {message.attachment && <img src={message.attachment} alt="" />}
            <p>{message.text}</p>
          </article>
        ))}

        {thinking && (
          <div className={styles.typing} aria-label="Poplur AI is responding">
            <i />
            <i />
            <i />
          </div>
        )}
      </div>

      <form
        className={styles.inputBar}
        onSubmit={event => { event.preventDefault(); send() }}
      >
        {attachment && (
          <div className={styles.attachment}>
            {attachment.url && <img src={attachment.url} alt="" />}
            <span>{attachment.name}</span>
            <button
              type="button"
              aria-label="Remove attachment"
              onClick={() => {
                if (attachment.url) {
                  URL.revokeObjectURL(attachment.url)
                  objectUrls.current.delete(attachment.url)
                }
                setAttachment(null)
              }}
            >
              ×
            </button>
          </div>
        )}
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.attach}
            aria-label="Add photo or video"
            onClick={() => fileInput.current?.click()}
          >
            +
          </button>
          <input
            ref={fileInput}
            className={styles.file}
            type="file"
            accept="image/*,video/*"
            onChange={event => {
              const file = event.currentTarget.files?.[0]
              if (!file) return
              setAttachment(current => {
                if (current?.url) {
                  URL.revokeObjectURL(current.url)
                  objectUrls.current.delete(current.url)
                }
                const url = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
                if (url) objectUrls.current.add(url)
                return {
                  name: file.name,
                  url,
                }
              })
              event.currentTarget.value = ''
            }}
          />
          <input
            className={styles.prompt}
            value={input}
            onChange={event => setInput(event.currentTarget.value)}
            placeholder="Message Poplur AI"
            aria-label="Message Poplur AI"
            onFocus={() => {
              layoutOrigin.current = { x: window.scrollX, y: window.scrollY }
              window.requestAnimationFrame(() => window.scrollTo(layoutOrigin.current.x, layoutOrigin.current.y))
            }}
          />
          <button type="submit" className={styles.send} aria-label="Send message" disabled={!input.trim() && !attachment}>↑</button>
        </div>
        <div className={styles.modes}>
          <button type="button" className={smartMode ? styles.modeOn : undefined} onClick={() => setSmartMode(value => !value)}>SMART</button>
          <button type="button" className={searchMode ? styles.modeOn : undefined} onClick={() => setSearchMode(value => !value)}>SEARCH</button>
        </div>
      </form>
    </section>
  )
}
