import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './PoplurVoiceAssistant.module.css'
import { isGateMuted } from './audioGate'
import { aiAnswer } from './ProfileTwin'
import { playPop } from './pop'
import type { CubeTab } from './CubeTab3D'
import { isNativeShell, postNativeEvent } from './nativeBridge'

type VoicePhase = 'idle' | 'listening' | 'thinking' | 'reply' | 'unavailable'

type RecognitionResultLike = {
  isFinal: boolean
  [index: number]: { transcript: string }
}

type RecognitionEventLike = Event & {
  resultIndex: number
  results: ArrayLike<RecognitionResultLike>
}

type RecognitionErrorEventLike = Event & { error?: string }

type RecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((event: RecognitionErrorEventLike) => void) | null
  onresult: ((event: RecognitionEventLike) => void) | null
  start: () => void
  stop: () => void
}

type RecognitionConstructor = new () => RecognitionLike

type NativeVoiceCommandDetail = {
  tab?: CubeTab
  channel?: string
  feedback?: string
}

const RESTART_DELAY_MS = 260
const RESPONSE_VISIBLE_MS = 4400

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const browser = window as typeof window & {
    SpeechRecognition?: RecognitionConstructor
    webkitSpeechRecognition?: RecognitionConstructor
  }
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition ?? null
}

function currentUsername(): string {
  if (typeof window === 'undefined') return 'there'
  const params = new URLSearchParams(window.location.search)
  if (params.get('username')) return params.get('username') as string
  try {
    return window.localStorage.getItem('poplur.username') ?? 'there'
  } catch {
    return 'there'
  }
}

function requestedTab(command: string): CubeTab | null {
  const normalized = command.toLowerCase()
  if (!/\b(open|show|go to|take me to|switch to)\b/.test(normalized)) return null
  if (/\b(map|globe)\b/.test(normalized)) return 'map'
  if (/\b(feed|channel|tv)\b/.test(normalized)) return 'feed'
  if (/\b(camera|post|create)\b/.test(normalized)) return 'post'
  if (/\b(profile|account)\b/.test(normalized)) return 'profile'
  return null
}

function speak(reply: string) {
  if (isGateMuted()) return
  try {
    const synth = window.speechSynthesis
    if (!synth) return
    synth.cancel()
    const utterance = new SpeechSynthesisUtterance(reply)
    utterance.rate = 0.98
    utterance.pitch = 1.03
    const voice = synth.getVoices().find(candidate => /^en-/i.test(candidate.lang))
    if (voice) utterance.voice = voice
    synth.speak(utterance)
  } catch {
    // Speech output is an enhancement; the visible reply remains available.
  }
}

// The controller remains mounted above every Home tab and arms the wake phrase
// as soon as Home is in the foreground. Browsers that require a user gesture
// get one silent retry on the first app interaction; the Profile equaliser can
// still explicitly open an immediate command session. Once permission is
// granted, recognition continuously restarts for the lifetime of Home.
export default function PoplurVoiceAssistant({
  onTabRequest,
  onChannelRequest,
}: {
  onTabRequest: (tab: CubeTab) => void
  onChannelRequest?: (channel: string) => void
}) {
  const [phase, setPhase] = useState<VoicePhase>('idle')
  const [message, setMessage] = useState('')
  const recognitionRef = useRef<RecognitionLike | null>(null)
  const recognitionRunningRef = useRef(false)
  const recognitionStartingRef = useRef(false)
  const listeningEnabledRef = useRef(false)
  const permissionBlockedRef = useRef(false)
  const awaitingCommandRef = useRef(false)
  const handlingCommandRef = useRef(false)
  const restartTimerRef = useRef<number | null>(null)
  const dismissTimerRef = useRef<number | null>(null)
  const tabRequestRef = useRef(onTabRequest)
  tabRequestRef.current = onTabRequest
  const channelRequestRef = useRef(onChannelRequest)
  channelRequestRef.current = onChannelRequest

  const clearDismissTimer = () => {
    if (dismissTimerRef.current != null) window.clearTimeout(dismissTimerRef.current)
    dismissTimerRef.current = null
  }

  const completeCommand = useCallback((command: string) => {
    const trimmed = command.trim()
    if (!trimmed || handlingCommandRef.current) return

    handlingCommandRef.current = true
    awaitingCommandRef.current = false
    clearDismissTimer()
    setPhase('thinking')
    setMessage('Thinking')

    const tab = requestedTab(trimmed)
    const reply = tab
      ? `Opening ${tab === 'post' ? 'camera' : tab}.`
      : aiAnswer(trimmed, currentUsername())

    window.setTimeout(() => {
      if (tab) tabRequestRef.current(tab)
      playPop()
      setPhase('reply')
      setMessage(reply)
      speak(reply)
      window.dispatchEvent(new CustomEvent('poplur-voice-response', { detail: { reply } }))
      handlingCommandRef.current = false
      dismissTimerRef.current = window.setTimeout(() => {
        setPhase('idle')
        setMessage('')
        dismissTimerRef.current = null
      }, RESPONSE_VISIBLE_MS)
    }, 280)
  }, [])

  const transcriptHandlerRef = useRef<(transcript: string) => void>(() => {})
  transcriptHandlerRef.current = transcript => {
    const wake = transcript.match(/\bhey\s+poplur\b[\s,!.:-]*(.*)$/i)
    if (wake) {
      playPop()
      awaitingCommandRef.current = true
      clearDismissTimer()
      setPhase('listening')
      setMessage('Listening')
      if (wake[1]?.trim()) completeCommand(wake[1])
      return
    }

    if (awaitingCommandRef.current) completeCommand(transcript)
  }

  const startRecognition = useCallback((): boolean => {
    const recognition = recognitionRef.current
    if (
      !recognition
      || recognitionRunningRef.current
      || recognitionStartingRef.current
      || document.visibilityState === 'hidden'
    ) return false
    try {
      recognitionStartingRef.current = true
      recognition.start()
      return true
    } catch {
      recognitionStartingRef.current = false
      // Chrome throws while a previous end event is still unwinding. Its
      // onend handler retries on the next short turn.
      return false
    }
  }, [])

  const ensureRecognition = useCallback(() => {
    if (recognitionRef.current) return recognitionRef.current
    const Constructor = recognitionConstructor()
    if (!Constructor) return null

    const recognition = new Constructor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-CA'
    recognition.onstart = () => {
      recognitionStartingRef.current = false
      recognitionRunningRef.current = true
      permissionBlockedRef.current = false
    }
    recognition.onend = () => {
      recognitionStartingRef.current = false
      recognitionRunningRef.current = false
      if (!listeningEnabledRef.current || document.visibilityState === 'hidden') return
      if (restartTimerRef.current != null) window.clearTimeout(restartTimerRef.current)
      restartTimerRef.current = window.setTimeout(() => {
        restartTimerRef.current = null
        startRecognition()
      }, RESTART_DELAY_MS)
    }
    recognition.onerror = event => {
      recognitionStartingRef.current = false
      // Another mic client (Studio/camera/native voice) can temporarily own
      // capture. That is contention, not a revoked permission: keep the wake
      // listener armed and retry after the competing capture has released it.
      if (event.error === 'audio-capture') {
        recognitionRunningRef.current = false
        if (restartTimerRef.current != null) window.clearTimeout(restartTimerRef.current)
        restartTimerRef.current = window.setTimeout(() => {
          restartTimerRef.current = null
          if (listeningEnabledRef.current) startRecognition()
        }, 1200)
        return
      }
      const blocked = event.error === 'not-allowed' || event.error === 'service-not-allowed'
      if (!blocked) return
      permissionBlockedRef.current = true
      listeningEnabledRef.current = false
      awaitingCommandRef.current = false
      setPhase('unavailable')
      setMessage('Microphone unavailable')
      clearDismissTimer()
      dismissTimerRef.current = window.setTimeout(() => {
        setPhase('idle')
        setMessage('')
        dismissTimerRef.current = null
      }, RESPONSE_VISIBLE_MS)
    }
    recognition.onresult = event => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        if (result?.isFinal) transcriptHandlerRef.current(result[0]?.transcript ?? '')
      }
    }
    recognitionRef.current = recognition
    return recognition
  }, [startRecognition])

  const startWakeListening = useCallback(() => {
    const recognition = ensureRecognition()
    if (!recognition || permissionBlockedRef.current) return
    listeningEnabledRef.current = true
    // Foreground/pageshow can arrive during an explicit command session. Keep
    // that session intact while re-arming the underlying recognizer.
    startRecognition()
  }, [ensureRecognition, startRecognition])

  const startVoice = useCallback(() => {
    const recognition = ensureRecognition()
    if (!recognition) {
      setPhase('unavailable')
      setMessage('Voice commands are unavailable here')
      clearDismissTimer()
      dismissTimerRef.current = window.setTimeout(() => {
        setPhase('idle')
        setMessage('')
        dismissTimerRef.current = null
      }, RESPONSE_VISIBLE_MS)
      return
    }

    permissionBlockedRef.current = false
    listeningEnabledRef.current = true
    awaitingCommandRef.current = true
    clearDismissTimer()
    setPhase('listening')
    setMessage('Listening')
    startRecognition()
  }, [ensureRecognition, startRecognition])

  useEffect(() => {
    const nativeShell = isNativeShell()
    const requestVoice = () => {
      // Native speech recognition is used on physical devices because neither
      // WKWebView nor Android WebView offers a dependable Web Speech session.
      // This bridge message is emitted only from the explicit HEY POPLUR tile,
      // so the host may ask for OS permission without showing a sheet at launch.
      if (nativeShell && postNativeEvent({ type: 'requestVoiceAssistant' })) return
      startVoice()
    }
    const receiveNativeCommand = (event: Event) => {
      const detail = (event as CustomEvent<NativeVoiceCommandDetail>).detail
      if (!detail || typeof detail !== 'object') return
      if (detail.tab === 'map' || detail.tab === 'feed' || detail.tab === 'post' || detail.tab === 'profile') {
        tabRequestRef.current(detail.tab)
      }
      if (typeof detail.channel === 'string' && detail.channel.trim()) {
        channelRequestRef.current?.(detail.channel)
      }
      // Deliberately do not render/speak/playPop here: the native assistant
      // owns both its feedback overlay and sounds on physical devices. This
      // event changes shared Home state only, preventing duplicate replies.
    }
    const resumeWakeListening = () => {
      if (document.visibilityState === 'hidden') {
        try { recognitionRef.current?.stop() } catch { /* already stopped */ }
        return
      }
      startWakeListening()
    }
    // Some WebViews accept this immediately (permission was granted by the
    // custom primer); Safari/Chrome variants that require a gesture throw or
    // report not-allowed. Give those one retry on the first real interaction,
    // without treating that ordinary tap as a voice command.
    if (!nativeShell) startWakeListening()
    const unlockWakeListening = () => {
      permissionBlockedRef.current = false
      startWakeListening()
    }
    window.addEventListener('poplur-voice-request', requestVoice)
    window.addEventListener('poplur-native-voice-command', receiveNativeCommand)
    if (!nativeShell) {
      window.addEventListener('focus', resumeWakeListening)
      window.addEventListener('pageshow', resumeWakeListening)
      document.addEventListener('visibilitychange', resumeWakeListening)
      window.addEventListener('pointerdown', unlockWakeListening, { passive: true })
      window.addEventListener('touchstart', unlockWakeListening, { passive: true })
      window.addEventListener('keydown', unlockWakeListening)
    }
    return () => {
      window.removeEventListener('poplur-voice-request', requestVoice)
      window.removeEventListener('poplur-native-voice-command', receiveNativeCommand)
      window.removeEventListener('focus', resumeWakeListening)
      window.removeEventListener('pageshow', resumeWakeListening)
      document.removeEventListener('visibilitychange', resumeWakeListening)
      window.removeEventListener('pointerdown', unlockWakeListening)
      window.removeEventListener('touchstart', unlockWakeListening)
      window.removeEventListener('keydown', unlockWakeListening)
      listeningEnabledRef.current = false
      awaitingCommandRef.current = false
      if (restartTimerRef.current != null) window.clearTimeout(restartTimerRef.current)
      clearDismissTimer()
      try { recognitionRef.current?.stop() } catch { /* already stopped */ }
    }
  }, [startVoice, startWakeListening])

  if (phase === 'idle') return null

  return (
    <div className={`${styles.assistant} ${styles[phase]}`} aria-live="polite" role="status">
      <div className={styles.edge} aria-hidden="true" />
      <div className={styles.status}>
        <span className={styles.bars} aria-hidden="true"><i /><i /><i /><i /><i /></span>
        <span>{message}</span>
      </div>
    </div>
  )
}
