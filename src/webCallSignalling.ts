// The browser's own call signalling — a straight port of PoplurCallSignalling
// (Swift) onto the web Firestore client. Same `calls/` doc shape, same field
// names, same `provider: "webrtc"` tag the native Agora listeners skip, so a
// browser and a phone are indistinguishable on the wire and can call each
// other. It emits the exact `poplurCall*` messages the native relay posts, via
// window.postMessage, so webCall's engine consumes them without caring which
// transport produced them.
//
// Loaded only when there is no native shell (dynamic import in webCall), so the
// firebase client never initialises inside the app, where native owns it.

import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, getDocs, onSnapshot,
  query, where, serverTimestamp,
} from 'firebase/firestore'
import { webDb, currentUid, currentDisplayName } from './webFirebase'

function emit(message: Record<string, unknown>): void {
  window.postMessage(message, '*')
}

let callUnsub: (() => void) | null = null
let candidateUnsub: (() => void) | null = null
let incomingUnsub: (() => void) | null = null

async function startCall(otherUID: string, callerName?: string, video = false): Promise<string | null> {
  const uid = currentUid()
  if (!uid || !otherUID || otherUID === uid) return null
  const ref = doc(collection(webDb(), 'calls'))
  const displayName = callerName ?? currentDisplayName() ?? 'Unknown'
  try {
    await setDoc(ref, {
      participants: [uid, otherUID].sort(),
      callerId: uid,
      callerName: displayName,
      calleeId: otherUID,
      status: 'ringing',
      // This is an intent flag, not media.  It lets the receiver choose the
      // FaceTime surface before the WebRTC offer is relayed.
      video,
      createdAt: serverTimestamp(),
      provider: 'webrtc',
    })
  } catch (err) {
    console.warn('[webCallSig] could not open call', err)
    return null
  }
  observe(ref.id)
  return ref.id
}

async function publishDescription(callId: string, type: string, sdp: string): Promise<void> {
  if (!callId) return
  const key = type === 'offer' ? 'offer' : 'answer'
  // The call document is already `ringing` before the caller creates its
  // offer.  Do not write that status a second time: a fast callee can accept
  // while the offer is still being published, and a late `ringing` merge
  // would otherwise resurrect the incoming-call query mid-call.
  const payload: Record<string, unknown> = { [key]: { type, sdp } }
  if (key === 'answer') payload.status = 'connected'
  await setDoc(
    doc(webDb(), 'calls', callId),
    payload,
    { merge: true },
  ).catch(err => console.warn('[webCallSig] publishDescription', err))
}

async function publishCandidate(callId: string, candidate: Record<string, unknown>): Promise<void> {
  const uid = currentUid()
  if (!uid || !callId) return
  await addDoc(
    collection(webDb(), 'calls', callId, 'candidates'),
    { ...candidate, senderId: uid, createdAt: serverTimestamp() },
  ).catch(err => console.warn('[webCallSig] publishCandidate', err))
}

async function endCall(callId: string): Promise<void> {
  if (!callId) return
  stopObserving()
  const ref = doc(webDb(), 'calls', callId)
  await setDoc(ref, { status: 'ended' }, { merge: true }).catch(() => { /* racing teardown */ })
  try {
    const snap = await getDocs(collection(webDb(), 'calls', callId, 'candidates'))
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)))
  } catch { /* best effort */ }
  await deleteDoc(ref).catch(() => { /* already gone */ })
}

async function declineCall(callId: string): Promise<void> {
  if (!callId) return
  await updateDoc(doc(webDb(), 'calls', callId), { status: 'declined' })
    .catch(err => console.warn('[webCallSig] declineCall', err))
}

async function acceptCall(callId: string): Promise<void> {
  if (!callId) return
  observe(callId)
  await updateDoc(doc(webDb(), 'calls', callId), { status: 'connected' })
    .catch(err => console.warn('[webCallSig] acceptCall', err))
}

function observe(callId: string): void {
  stopObserving()
  const uid = currentUid()
  if (!uid) return
  const ref = doc(webDb(), 'calls', callId)

  callUnsub = onSnapshot(ref, snap => {
    const data = snap.data()
    if (!data) { emit({ type: 'poplurCallEnded', callId }); stopObserving(); return }
    const status = (data.status as string) ?? ''
    if (status === 'ended' || status === 'declined') {
      emit({ type: 'poplurCallEnded', callId, reason: status })
      stopObserving()
      return
    }
    // Each side needs only the OTHER side's description.
    const wanted = data.callerId === uid ? 'answer' : 'offer'
    const description = data[wanted] as { type?: string; sdp?: string } | undefined
    if (description?.sdp) {
      emit({ type: 'poplurCallDescription', callId, sdpType: description.type ?? wanted, sdp: description.sdp })
    }
  })

  candidateUnsub = onSnapshot(collection(ref, 'candidates'), snap => {
    snap.docChanges().forEach(change => {
      if (change.type !== 'added') return
      const data = { ...change.doc.data() } as Record<string, unknown>
      // Your own candidates come back on the same listener; skip them.
      if (data.senderId === uid) return
      delete data.senderId
      delete data.createdAt
      emit({ type: 'poplurCallCandidate', callId, candidate: data })
    })
  })
}

/** Watch for someone calling YOU. Auto-started once the browser user signs in. */
export function observeIncoming(): void {
  const uid = currentUid()
  if (!uid) return
  incomingUnsub?.()
  const q = query(
    collection(webDb(), 'calls'),
    where('calleeId', '==', uid),
    where('status', '==', 'ringing'),
  )
  incomingUnsub = onSnapshot(q, snap => {
    snap.docChanges().forEach(change => {
      if (change.type === 'removed') {
        emit({ type: 'poplurCallIncomingUnavailable', callId: change.doc.id })
        return
      }
      if (change.type !== 'added') return
      const data = change.doc.data()
      emit({
        type: 'poplurCallIncoming',
        callId: change.doc.id,
        callerId: (data.callerId as string) ?? '',
        callerName: (data.callerName as string) ?? 'Unknown',
        video: data.video === true,
      })
    })
  })
}

function stopObserving(): void {
  callUnsub?.(); callUnsub = null
  candidateUnsub?.(); candidateUnsub = null
}

export function stopAll(): void {
  stopObserving()
  incomingUnsub?.(); incomingUnsub = null
}

/**
 * The dispatcher webCall calls when there is no native bridge. The intent
 * names are exactly those the native handler switches on, so webCall routes to
 * either transport with the same messages.
 */
export function handleSignal(message: Record<string, unknown>): void {
  const m = message
  switch (m.type) {
    case 'callStart':
      {
      const requestId = String(m.requestId ?? '')
      void startCall(
        String(m.otherId ?? ''),
        typeof m.callerName === 'string' ? m.callerName : undefined,
        m.video === true,
      )
        .then(id => emit({ type: 'poplurCallStarted', callId: id ?? '', ok: !!id, requestId }))
      break
      }
    case 'callAccept': void acceptCall(String(m.callId ?? '')); break
    case 'callDescription':
      void publishDescription(String(m.callId ?? ''), String(m.sdpType ?? 'offer'), String(m.sdp ?? ''))
      break
    case 'callCandidate':
      void publishCandidate(String(m.callId ?? ''), (m.candidate as Record<string, unknown>) ?? {})
      break
    case 'callEnd': void endCall(String(m.callId ?? '')); break
    case 'callDecline': void declineCall(String(m.callId ?? '')); break
    case 'callWatchIncoming': observeIncoming(); break
  }
}
