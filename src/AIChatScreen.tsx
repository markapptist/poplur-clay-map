import React, { useEffect, useRef, useState } from 'react'
import styles from './AIChatScreen.module.css'
import { playPop } from './pop'
import { takePendingAICompose } from './cameraStore'
import { generateWithPoplurAI, prepareAIImageSource } from './aiGeneration'

type ChatMessage = {
  id: number
  role: 'user' | 'assistant'
  text: string
  attachment?: string
  generated?: boolean
}

type RecognitionAlternative = { transcript: string }
type RecognitionResult = { [index: number]: RecognitionAlternative }
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> }
type RecognitionErrorEvent = { error: string }
type VoiceRecognition = {
  lang: string
  interimResults: boolean
  continuous: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: RecognitionEvent) => void) | null
  onerror: ((event: RecognitionErrorEvent) => void) | null
  onend: (() => void) | null
}
type VoiceRecognitionConstructor = new () => VoiceRecognition

const SUGGESTIONS = [
  { label: 'Make this cinematic', icon: 'FILM' },
  { label: 'Write a caption', icon: 'WORD' },
  { label: 'Find a creative angle', icon: 'IDEA' },
  { label: 'Build a campaign', icon: 'PLAN' },
]

const AI_TIPS = [
  {
    eyebrow: 'AI TIP · STORYTELLING',
    title: 'Turn a moment into a story.',
    detail: 'Give a photo or clip a mood, a point of view, and an ending people remember.',
    prompt: 'Make this feel like the opening scene of an indie film.',
    spark: '✦',
  },
  {
    eyebrow: 'AI TIP · CAPTIONS',
    title: 'Find the words that stop the scroll.',
    detail: 'Ask for captions, hooks, or a voice that sounds like you — not a template.',
    prompt: 'Write three playful captions for this post.',
    spark: '✎',
  },
  {
    eyebrow: 'AI TIP · CREATIVE PLAN',
    title: 'Build your next pop from one idea.',
    detail: 'Turn a place, audience, and feeling into a clear shoot or launch plan.',
    prompt: 'Build a launch plan for a summer rooftop event.',
    spark: '◎',
  },
  {
    eyebrow: 'AI TIP · SOUND + EDIT',
    title: 'Make every beat feel intentional.',
    detail: 'Ask for an edit rhythm, a music direction, or the perfect final frame.',
    prompt: 'Suggest a track mood and three edits for this clip.',
    spark: '♫',
  },
]

const LISTENING_NOTE = 'Listening — your words are being added to the message.'

function speechRecognitionConstructor(): VoiceRecognitionConstructor | undefined {
  const speechWindow = window as Window & {
    SpeechRecognition?: VoiceRecognitionConstructor
    webkitSpeechRecognition?: VoiceRecognitionConstructor
  }
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
}

export default function AIChatScreen({
  onClose,
  bindBack,
}: {
  onClose: () => void
  bindBack?: (fn: (() => boolean) | null) => void
}) {
  const [view, setView] = useState<'home' | 'chat'>('home')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [attachment, setAttachment] = useState<{ name: string; url?: string } | null>(null)
  const [thinking, setThinking] = useState(false)
  const [composerHandoff, setComposerHandoff] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [smartMode, setSmartMode] = useState(true)
  const [searchMode, setSearchMode] = useState(false)
  const [dictating, setDictating] = useState(false)
  const [dictationNote, setDictationNote] = useState('')
  const [tipIndex, setTipIndex] = useState(0)
  const nextId = useRef(1)
  const replyTimer = useRef<number | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const promptInput = useRef<HTMLInputElement | null>(null)
  const inputBar = useRef<HTMLFormElement | null>(null)
  const conversation = useRef<HTMLDivElement | null>(null)
  const screen = useRef<HTMLElement | null>(null)
  const objectUrls = useRef(new Set<string>())
  const recognition = useRef<VoiceRecognition | null>(null)
  const dictatedPrefix = useRef('')

  const requestGeneration = (prompt: string, sourceSrc?: string) => {
    const requested = prompt.trim() || 'Create an original Poplur social image.'
    setThinking(true)
    const source = sourceSrc ? prepareAIImageSource(sourceSrc) : Promise.resolve(undefined)
    void source.then(sourceImage => generateWithPoplurAI({
      prompt: requested,
      sourceImage,
      metadata: { surface: 'ai_chat' },
    }))
      .then(result => {
        if (result.status !== 'completed' || !result.outputUrl) {
          throw new Error('Your AI job is still processing. Please try again shortly.')
        }
        const outputUrl = result.outputUrl
        setMessages(current => [
          ...current,
          {
            id: nextId.current++,
            role: 'assistant',
            text: 'Created with Poplur AI. Review it before you post.',
            attachment: outputUrl,
            generated: true,
          },
        ])
      })
      .catch(error => {
        setMessages(current => [
          ...current,
          { id: nextId.current++, role: 'assistant', text: error instanceof Error ? error.message : 'Poplur AI could not generate that right now.' },
        ])
      })
      .finally(() => setThinking(false))
  }

  useEffect(() => () => {
    if (replyTimer.current) window.clearTimeout(replyTimer.current)
    recognition.current?.abort()
    objectUrls.current.forEach(url => URL.revokeObjectURL(url))
    objectUrls.current.clear()
  }, [])

  // A capture handed over from the camera's "Generate in Poplur AI" action.
  // The camera owns its own object URL, so this screen only revokes URLs it
  // creates from its own attachment picker.
  useEffect(() => {
    const job = takePendingAICompose()
    if (!job) return
    const prompt = job.prompt.trim() || 'Use Poplur AI on this capture.'
    setComposerHandoff(true)
    setView('chat')
    setMessages([{
      id: nextId.current++,
      role: 'user',
      text: prompt,
      attachment: job.media.src,
    }])
    setInput('')
    setAttachment(null)
    requestGeneration(prompt, job.media.kind === 'photo' ? job.media.src : undefined)
  }, [])

  useEffect(() => {
    conversation.current?.scrollTo({ top: conversation.current.scrollHeight, behavior: 'smooth' })
  }, [messages, thinking])

  useEffect(() => {
    const viewport = window.visualViewport
    const syncKeyboardClearance = () => {
      const root = screen.current
      if (!root) return
      const viewportBottom = viewport
        ? viewport.offsetTop + viewport.height
        : window.innerHeight
      const keyboardInset = Math.max(0, root.getBoundingClientRect().bottom - viewportBottom)
      root.style.setProperty('--ai-keyboard-inset', `${Math.round(keyboardInset)}px`)

      // The home state is the scroll owner. Once the keyboard has changed the
      // visual viewport, advance only that local scroller by the exact amount
      // needed to keep the composer comfortably tappable above the keyboard.
      if (document.activeElement !== promptInput.current || !root.classList.contains(styles.homeScreen)) return
      // governor-ok: one-shot keyboard-layout correction from a viewport event; it never self-schedules.
      window.requestAnimationFrame(() => {
        const formBottom = inputBar.current?.getBoundingClientRect().bottom
        const currentViewportBottom = viewport
          ? viewport.offsetTop + viewport.height
          : window.innerHeight
        if (formBottom !== undefined && formBottom > currentViewportBottom - 12) {
          root.scrollTop += formBottom - currentViewportBottom + 12
        }
      })
    }

    syncKeyboardClearance()
    viewport?.addEventListener('resize', syncKeyboardClearance)
    viewport?.addEventListener('scroll', syncKeyboardClearance)
    window.addEventListener('resize', syncKeyboardClearance)
    return () => {
      viewport?.removeEventListener('resize', syncKeyboardClearance)
      viewport?.removeEventListener('scroll', syncKeyboardClearance)
      window.removeEventListener('resize', syncKeyboardClearance)
      screen.current?.style.removeProperty('--ai-keyboard-inset')
    }
  }, [])

  // Create home and a live conversation are two levels of the same screen.
  // Hand the inner level to the shared cube so it returns to Create home
  // rather than closing the whole camera tab.
  useEffect(() => {
    if (!bindBack) return undefined
    bindBack(() => {
      if (view !== 'chat') return false
      if (replyTimer.current) window.clearTimeout(replyTimer.current)
      replyTimer.current = null
      recognition.current?.stop()
      setThinking(false)
      setMessages([])
      setInput('')
      setAttachment(null)
      setDictationNote('')
      setView('home')
      // governor-ok: one-shot post-commit scroll reset; this callback never rearms itself.
      window.requestAnimationFrame(() => screen.current?.scrollTo({ top: 0 }))
      return true
    })
    return () => bindBack(null)
  }, [view, bindBack])

  // A leisurely rotation keeps the Create screen useful without a continuous
  // animation loop. Reduced-motion users keep the first tip and can still use
  // the explicit previous/next controls.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined
    const timer = window.setInterval(() => setTipIndex(index => (index + 1) % AI_TIPS.length), 6500)
    return () => window.clearInterval(timer)
  }, [])

  const send = (value = input) => {
    const text = value.trim()
    if (thinking || (!text && !attachment)) return
    recognition.current?.stop()
    playPop()
    setView('chat')
    // governor-ok: one-shot post-commit scroll reset; this callback never rearms itself.
    window.requestAnimationFrame(() => screen.current?.scrollTo({ top: 0 }))
    const userMessage: ChatMessage = {
      id: nextId.current++,
      role: 'user',
      text: text || attachment?.name || 'Attachment',
      attachment: attachment?.url,
    }
    setMessages(current => [...current, userMessage])
    setInput('')
    setAttachment(null)
    setDictationNote('')
    requestGeneration(text || attachment?.name || '', attachment?.url)
  }

  const dictate = () => {
    if (recognition.current && dictating) {
      recognition.current.stop()
      return
    }

    const Constructor = speechRecognitionConstructor()
    if (!Constructor) {
      setDictationNote('Voice-to-text is not available in this browser. Type your message instead.')
      promptInput.current?.focus()
      return
    }

    const session = new Constructor()
    let hadError = false
    dictatedPrefix.current = input.trim()
    session.lang = navigator.language || 'en-CA'
    session.interimResults = true
    session.continuous = false
    session.onresult = event => {
      let transcript = ''
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript += event.results[index]?.[0]?.transcript ?? ''
      }
      const next = [dictatedPrefix.current, transcript.trim()].filter(Boolean).join(' ')
      setInput(next)
    }
    session.onerror = event => {
      hadError = true
      setDictating(false)
      setDictationNote(event.error === 'not-allowed'
        ? 'Allow microphone access to use voice-to-text.'
        : 'Voice-to-text could not hear that. You can try again or type your message.')
    }
    session.onend = () => {
      recognition.current = null
      setDictating(false)
      setDictationNote(note => hadError
        ? note
        : note === LISTENING_NOTE
          ? 'Voice-to-text added to your message. Review it, then send when ready.'
          : note)
      // governor-ok: one-shot focus after recognition state settles; this callback never rearms itself.
      window.requestAnimationFrame(() => promptInput.current?.focus())
    }

    recognition.current = session
    setDictating(true)
    setDictationNote(LISTENING_NOTE)
    try {
      session.start()
    } catch {
      recognition.current = null
      setDictating(false)
      setDictationNote('Voice-to-text could not start. Type your message instead.')
    }
  }

  const removeAttachment = () => {
    if (attachment?.url && objectUrls.current.has(attachment.url)) {
      URL.revokeObjectURL(attachment.url)
      objectUrls.current.delete(attachment.url)
    }
    setAttachment(null)
  }

  const activeTip = AI_TIPS[tipIndex]
  const useTipPrompt = () => {
    playPop()
    setInput(activeTip.prompt)
    setDictationNote('')
    // governor-ok: one-shot focus after the prompt state update; this callback never rearms itself.
    window.requestAnimationFrame(() => promptInput.current?.focus())
  }

  const moveTip = (direction: -1 | 1) => {
    playPop()
    setTipIndex(index => (index + direction + AI_TIPS.length) % AI_TIPS.length)
  }

  return (
    <section ref={screen} className={`${styles.screen} ${view === 'home' ? styles.homeScreen : styles.chatScreen}`} aria-label="Poplur AI chat">
      <div className={styles.starField} aria-hidden="true" />
      <header className={styles.header}>
        <div className={styles.identity}>
          <span className={styles.mark} aria-hidden="true">P</span>
          <span>
            <strong>poplur <b>AI</b></strong>
            <small><i /> YOUR CREATIVE COPILOT</small>
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
          <label><span>Smart mode</span><input type="checkbox" checked={smartMode} onChange={event => setSmartMode(event.currentTarget.checked)} /></label>
          <label><span>Search mode</span><input type="checkbox" checked={searchMode} onChange={event => setSearchMode(event.currentTarget.checked)} /></label>
        </div>
      )}

      <div
        className={styles.conversation}
        ref={conversation}
        data-clay-scroll
        tabIndex={0}
        aria-label="Poplur AI conversation"
      >
        {view === 'home' && <section className={styles.carousel} aria-roledescription="carousel" aria-label="Poplur AI tips and example prompts">
          <article className={styles.introCard} aria-live="off">
            <span className={styles.eyebrow}>{activeTip.eyebrow}</span>
            <h1>{activeTip.title}</h1>
            <p>{activeTip.detail}</p>
            <button type="button" className={styles.tipPrompt} onClick={useTipPrompt}>
              <small>TRY THIS PROMPT</small>
              <span>{activeTip.prompt}</span>
            </button>
            <span className={styles.introSpark} aria-hidden="true">{activeTip.spark}</span>
          </article>
          <div className={styles.carouselControls}>
            <button type="button" aria-label="Previous AI tip" onClick={() => moveTip(-1)}>‹</button>
            <span className={styles.tipCount}>{tipIndex + 1} / {AI_TIPS.length}</span>
            <div className={styles.tipDots} aria-label={`Tip ${tipIndex + 1} of ${AI_TIPS.length}`}>
              {AI_TIPS.map((tip, index) => (
                <button
                  type="button"
                  key={tip.eyebrow}
                  className={index === tipIndex ? styles.tipDotActive : undefined}
                  aria-label={`Show tip ${index + 1}`}
                  aria-current={index === tipIndex ? 'true' : undefined}
                  onClick={() => setTipIndex(index)}
                />
              ))}
            </div>
            <button type="button" aria-label="Next AI tip" onClick={() => moveTip(1)}>›</button>
          </div>
        </section>}

        {view === 'home' && (
          <div className={styles.welcome}>
            <div className={styles.suggestionHeading}><span>START A CONVERSATION</span><i /></div>
            <div className={styles.suggestions}>
              {SUGGESTIONS.map(suggestion => (
                <button type="button" key={suggestion.label} onClick={() => send(suggestion.label)}>
                  <b aria-hidden="true">{suggestion.icon}</b>
                  <span>{suggestion.label}</span>
                  <em aria-hidden="true">↗</em>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(message => (
          <article className={message.role === 'user' ? styles.userMessage : styles.assistantMessage} key={message.id}>
            <span className={styles.messageAuthor}>{message.role === 'assistant' ? 'P  POPLUR AI' : 'YOU'}{message.generated ? ' · AI IMAGE' : ''}</span>
            {message.attachment && <img src={message.attachment} alt="" />}
            <p>{message.text}</p>
          </article>
        ))}

        {thinking && <div className={styles.typing} aria-label="Poplur AI is responding"><i /><i /><i /></div>}
        {composerHandoff && !thinking && messages.some(message => message.generated && message.attachment) && (
          <button
            type="button"
            className={styles.continuePost}
            onClick={() => {
              playPop()
              const generated = [...messages].reverse().find(message => message.generated && message.attachment)
              window.dispatchEvent(new CustomEvent('poplur-ai-compose-finished', {
                detail: generated?.attachment ? { media: { kind: 'photo', src: generated.attachment } } : undefined,
              }))
              onClose()
            }}
          >
            Continue to post
          </button>
        )}
      </div>

      <form ref={inputBar} className={styles.inputBar} onSubmit={event => { event.preventDefault(); send() }}>
        {attachment && (
          <div className={styles.attachment}>
            {attachment.url && <img src={attachment.url} alt="" />}
            <span>{attachment.name}</span>
            <button type="button" aria-label="Remove attachment" onClick={removeAttachment}>×</button>
          </div>
        )}
        <div className={styles.controls}>
          <button type="button" className={styles.attach} aria-label="Add photo or video" onClick={() => fileInput.current?.click()}>+</button>
          <input
            ref={fileInput}
            className={styles.file}
            type="file"
            accept="image/*,video/*"
            onChange={event => {
              const file = event.currentTarget.files?.[0]
              if (!file) return
              setAttachment(current => {
                if (current?.url && objectUrls.current.has(current.url)) {
                  URL.revokeObjectURL(current.url)
                  objectUrls.current.delete(current.url)
                }
                const url = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
                if (url) objectUrls.current.add(url)
                return { name: file.name, url }
              })
              event.currentTarget.value = ''
            }}
          />
          <button
            type="button"
            className={`${styles.mic} ${dictating ? styles.micActive : ''}`}
            aria-label={dictating ? 'Stop voice-to-text' : 'Dictate message'}
            aria-pressed={dictating}
            onClick={dictate}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-6 8a6 6 0 0 0 12 0M12 17v4M8 21h8" /></svg>
          </button>
          <input
            ref={promptInput}
            className={styles.prompt}
            value={input}
            onChange={event => { setInput(event.currentTarget.value); setDictationNote('') }}
            placeholder="Message Poplur AI"
            aria-label="Message Poplur AI"
            onFocus={() => {
              // governor-ok: one-shot local reveal after the keyboard begins
              // resizing the visual viewport; the viewport listener above
              // applies the exact remaining correction once it settles.
              window.requestAnimationFrame(() => inputBar.current?.scrollIntoView({ block: 'nearest' }))
            }}
          />
          <button type="submit" className={styles.send} aria-label="Send message" disabled={thinking || (!input.trim() && !attachment)}>↑</button>
        </div>
        {dictationNote && <p className={styles.dictationNote} role="status">{dictationNote}</p>}
        <div className={styles.modes}>
          <button type="button" className={smartMode ? styles.modeOn : undefined} onClick={() => setSmartMode(value => !value)}>SMART</button>
          <span>VOICE-TO-TEXT · YOU SEND</span>
          <button type="button" className={searchMode ? styles.modeOn : undefined} onClick={() => setSearchMode(value => !value)}>SEARCH</button>
        </div>
      </form>
    </section>
  )
}
