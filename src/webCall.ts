// The Poplur phone's voice, in the browser.
//
// The call SIGNALLING already exists end to end: PoplurCallSignalling (native)
// opens a `calls/` doc, relays the offer/answer and ICE candidates through
// Firestore, and pushes them back to the page as `poplurCall*` messages. What
// was missing everywhere — web, iOS WebView, Android WebView — is the piece
// that actually carries the voice: an RTCPeerConnection that captures the mic,
// answers with SDP, trades ICE, and plays the far side. That is this file.
//
// It is deliberately transport-agnostic. Today it speaks to the signalling
// through the native bridge (postNativeEvent + window 'message'); a browser
// with no native shell will later reach the same `calls/` collection through
// web Firebase (Stage 2). The RTCPeerConnection below does not change when the
// transport does — the same engine runs on every platform, which is the whole
// point of doing call media in the page rather than per-native-SDK.

import { postNativeEvent, isNativeShell } from './nativeBridge'

export type CallPhase =
  | 'idle'        // nothing happening
  | 'calling'     // caller: ringing the other side
  | 'connecting'  // media negotiating (either side)
  | 'connected'   // call media is flowing
  | 'ended'       // just torn down, about to settle to idle

export interface CallSnapshot {
  phase: CallPhase
  callId: string
  peerName: string
  muted: boolean
  /** ms epoch the call connected, for the in-call timer; null until connected. */
  connectedAt: number | null
  /** true while the caller is ringing but not yet answered. */
  outgoing: boolean
}

/**
 * The media belonging to the one active call.  Voice calls can leave the
 * video tracks absent; FaceTime subscribes here rather than opening a second,
 * unrelated getUserMedia stream just to paint its tiles.
 */
export interface CallMediaSnapshot {
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  video: boolean
}

export interface CallOptions {
  /** Ask the peer connection for camera tracks as well as the call audio. */
  video?: boolean
}

// Public STUN only. A production deployment adds TURN for the ~10% of networks
// that will not traverse with STUN alone; that is a credentials/relay decision,
// not a change to this engine.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

// Signalling transport. Inside the app the native bridge carries the messages;
// in a plain browser they go to the web Firestore backend, which is loaded
// lazily so the firebase client never initialises inside the native shell.
type WebBackend = typeof import('./webCallSignalling')
let webBackend: WebBackend | null = null
let webBackendLoading: Promise<WebBackend> | null = null

function loadWebBackend(): Promise<WebBackend> {
  if (webBackend) return Promise.resolve(webBackend)
  if (!webBackendLoading) webBackendLoading = import('./webCallSignalling').then(m => { webBackend = m; return m })
  return webBackendLoading
}

function sendSignal(message: Record<string, unknown>): void {
  if (postNativeEvent(message)) return
  if (webBackend) { webBackend.handleSignal(message); return }
  void loadWebBackend().then(m => m.handleSignal(message))
}

let pc: RTCPeerConnection | null = null
let localStream: MediaStream | null = null
let remoteStream: MediaStream | null = null
let remoteAudio: HTMLAudioElement | null = null

let callId = ''
let isCaller = false
let outgoing = false
let peerName = ''
let phase: CallPhase = 'idle'
let muted = false
let connectedAt: number | null = null
let videoRequested = false

// The far side's ICE can arrive before its description is set; applying a
// candidate before setRemoteDescription throws, so hold them until the
// description lands.
let remoteDescriptionSet = false
let pendingCandidates: RTCIceCandidateInit[] = []

const listeners = new Set<(s: CallSnapshot) => void>()
const mediaListeners = new Set<(s: CallMediaSnapshot) => void>()

function snapshot(): CallSnapshot {
  return { phase, callId, peerName, muted, connectedAt, outgoing }
}

function emit(): void {
  const s = snapshot()
  listeners.forEach(l => { try { l(s) } catch { /* listener's problem */ } })
}

function mediaSnapshot(): CallMediaSnapshot {
  return { localStream, remoteStream, video: videoRequested }
}

function emitMedia(): void {
  const s = mediaSnapshot()
  mediaListeners.forEach(l => { try { l(s) } catch { /* listener's problem */ } })
}

/** Subscribe to call state; fires immediately with the current snapshot. */
export function subscribeCall(listener: (s: CallSnapshot) => void): () => void {
  listeners.add(listener)
  listener(snapshot())
  return () => { listeners.delete(listener) }
}

export function callState(): CallSnapshot {
  return snapshot()
}

/** Subscribe to the actual media tracks for the active call. */
export function subscribeCallMedia(listener: (s: CallMediaSnapshot) => void): () => void {
  mediaListeners.add(listener)
  listener(mediaSnapshot())
  return () => { mediaListeners.delete(listener) }
}

function setPhase(p: CallPhase): void {
  if (phase === p) return
  phase = p
  emit()
}

function ensureRemoteAudio(): HTMLAudioElement {
  if (remoteAudio) return remoteAudio
  const el = document.createElement('audio')
  el.autoplay = true
  el.setAttribute('playsinline', '')
  el.style.display = 'none'
  document.body.appendChild(el)
  remoteAudio = el
  return el
}

async function ensureLocalMedia(video: boolean): Promise<MediaStream | null> {
  if (localStream && (!video || localStream.getVideoTracks().length > 0)) return localStream
  // A call cannot upgrade an already-published audio stream in place without
  // renegotiating. There is only one active call, so clean up the stale stream
  // before taking the video-capable one requested by FaceTime.
  localStream?.getTracks().forEach(track => track.stop())
  localStream = null
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video })
    emitMedia()
    return localStream
  } catch (err) {
    console.warn(`[webCall] ${video ? 'camera or microphone' : 'microphone'} unavailable/denied`, err)
    return null
  }
}

function buildPeer(): RTCPeerConnection {
  const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS })

  peer.onicecandidate = ev => {
    if (ev.candidate && callId) {
      sendSignal({ type: 'callCandidate', callId, candidate: ev.candidate.toJSON() })
    }
  }

  peer.ontrack = ev => {
    const stream = ev.streams[0]
    if (stream) {
      remoteStream = stream
    } else {
      if (!remoteStream) remoteStream = new MediaStream()
      if (!remoteStream.getTracks().some(track => track.id === ev.track.id)) remoteStream.addTrack(ev.track)
    }
    const audio = ensureRemoteAudio()
    audio.srcObject = remoteStream
    void audio.play?.().catch(() => { /* autoplay policies; user gesture opened the call */ })
    emitMedia()
  }

  peer.onconnectionstatechange = () => {
    switch (peer.connectionState) {
      case 'connected':
        if (connectedAt == null) connectedAt = Date.now()
        outgoing = false
        setPhase('connected')
        break
      case 'failed':
      case 'disconnected':
      case 'closed':
        if (phase !== 'idle' && phase !== 'ended') hangup()
        break
    }
  }

  if (localStream) {
    localStream.getTracks().forEach(track => peer.addTrack(track, localStream as MediaStream))
  }
  return peer
}

/**
 * Place a call. The mic is opened first (so the offer already carries audio),
 * then native opens the `calls/` doc and answers with `poplurCallStarted`
 * carrying the id we build the offer against.
 */
export async function placeCall(peerId: string, name: string, callerName?: string, options: CallOptions = {}): Promise<void> {
  if (phase !== 'idle') return
  peerName = name
  isCaller = true
  outgoing = true
  videoRequested = Boolean(options.video)
  emitMedia()
  setPhase('calling')

  const media = await ensureLocalMedia(videoRequested)
  if (!media) { cleanup('ended'); return }

  // Native bridge inside the app; the web Firestore backend in a plain browser.
  // Either way the rendezvous opens and answers with poplurCallStarted.
  // Persist the media intent with the rendezvous.  The callee needs this
  // before it has received the SDP offer so an incoming FaceTime can open its
  // camera and the shared video surface, while ordinary phone calls remain
  // audio-only.
  sendSignal({ type: 'callStart', otherId: peerId, callerName, video: videoRequested })
}

async function onCallStarted(id: string, ok: boolean): Promise<void> {
  if (!isCaller) return
  if (!ok || !id) { cleanup('ended'); return }
  callId = id
  pc = buildPeer()
  const offer = await pc.createOffer({
    offerToReceiveAudio: true,
    offerToReceiveVideo: videoRequested,
  })
  await pc.setLocalDescription(offer)
  sendSignal({ type: 'callDescription', callId, sdpType: 'offer', sdp: offer.sdp ?? '' })
}

/**
 * Accept an incoming call. Builds the peer and tells native to observe; the
 * caller's offer then arrives as `poplurCallDescription` and we answer it.
 */
export async function acceptCall(id: string, name: string, options: CallOptions = {}): Promise<void> {
  if (phase === 'connected' || phase === 'connecting') return
  callId = id
  peerName = name
  isCaller = false
  outgoing = false
  videoRequested = Boolean(options.video)
  emitMedia()
  setPhase('connecting')

  const media = await ensureLocalMedia(videoRequested)
  if (!media) { hangup(); return }

  pc = buildPeer()
  sendSignal({ type: 'callAccept', callId })
}

async function onRemoteDescription(sdpType: string, sdp: string): Promise<void> {
  if (!pc || remoteDescriptionSet) return
  try {
    if (isCaller) {
      if (sdpType !== 'answer') return
      await pc.setRemoteDescription({ type: 'answer', sdp })
      remoteDescriptionSet = true
      flushCandidates()
      setPhase('connecting')
    } else {
      if (sdpType !== 'offer') return
      await pc.setRemoteDescription({ type: 'offer', sdp })
      remoteDescriptionSet = true
      flushCandidates()
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      sendSignal({ type: 'callDescription', callId, sdpType: 'answer', sdp: answer.sdp ?? '' })
    }
  } catch (err) {
    console.warn('[webCall] failed to apply remote description', err)
  }
}

function onRemoteCandidate(candidate: RTCIceCandidateInit): void {
  if (!pc || !remoteDescriptionSet) { pendingCandidates.push(candidate); return }
  void pc.addIceCandidate(candidate).catch(err => console.warn('[webCall] addIceCandidate', err))
}

function flushCandidates(): void {
  if (!pc) return
  const queued = pendingCandidates
  pendingCandidates = []
  queued.forEach(c => { void pc?.addIceCandidate(c).catch(() => { /* stale candidate */ }) })
}

/** Mute/unmute the local mic. Returns the new muted state. */
export function toggleMute(): boolean {
  muted = !muted
  localStream?.getAudioTracks().forEach(track => { track.enabled = !muted })
  emit()
  return muted
}

/** Hang up: tell the far side, tear down, settle to idle. */
export function hangup(): void {
  if (callId) sendSignal({ type: 'callEnd', callId })
  cleanup('ended')
}

function cleanup(finalPhase: CallPhase): void {
  try { pc?.getSenders().forEach(s => s.track?.stop()) } catch { /* already closing */ }
  try { pc?.close() } catch { /* already closed */ }
  pc = null
  localStream?.getTracks().forEach(t => t.stop())
  localStream = null
  if (remoteAudio) remoteAudio.srcObject = null
  remoteStream = null
  remoteDescriptionSet = false
  pendingCandidates = []
  isCaller = false
  connectedAt = null
  callId = ''
  videoRequested = false
  emitMedia()

  setPhase(finalPhase)
  // 'ended' is a brief flash so the UI can show "call ended" before it clears;
  // everything else resets immediately.
  const settle = () => { phase = 'idle'; peerName = ''; muted = false; outgoing = false; emit() }
  if (finalPhase === 'ended') window.setTimeout(() => { if (phase === 'ended') settle() }, 500)
  else settle()
}

// The native→web half of the transport. One global listener turns the
// signalling relay's messages into engine calls. Installed once, idempotently.
let bridgeInstalled = false

export function installCallBridge(): void {
  if (bridgeInstalled || typeof window === 'undefined') return
  bridgeInstalled = true
  window.addEventListener('message', (ev: MessageEvent) => {
    const d = ev.data
    if (!d || typeof d !== 'object') return
    switch (d.type) {
      case 'poplurCallStarted':
        void onCallStarted(String(d.callId ?? ''), d.ok !== false)
        break
      case 'poplurCallDescription':
        if (d.callId === callId) void onRemoteDescription(String(d.sdpType ?? ''), String(d.sdp ?? ''))
        break
      case 'poplurCallCandidate':
        if (d.callId === callId && d.candidate) onRemoteCandidate(d.candidate as RTCIceCandidateInit)
        break
      case 'poplurCallEnded':
        if (!callId || d.callId === callId) cleanup('ended')
        break
    }
  })

  // In a plain browser there is no native shell posting incoming-call events,
  // so bring up the web Firestore signalling and watch for calls to us the
  // moment a user is signed in. Inside the app this is skipped — native owns it.
  if (!isNativeShell()) {
    void Promise.all([loadWebBackend(), import('./webFirebase')]).then(([backend, fb]) => {
      fb.onUser(user => { if (user) backend.observeIncoming() })
    })
  }
}
