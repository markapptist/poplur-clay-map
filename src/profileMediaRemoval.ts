import { doc, setDoc } from 'firebase/firestore'
import { isNativeShell, postNativeEvent } from './nativeBridge'
import { currentUid, webDb } from './webFirebase'

/** Resolve only after the account accepts removal. A missing bridge or an
 * offline write must not turn a still-saved portrait into a false success. */
export async function removeProfileMedia(): Promise<void> {
  if (!isNativeShell()) {
    const uid = currentUid()
    if (uid) await setDoc(doc(webDb(), 'users', uid), {
      profilePictureURL: null, photoURL: null, avatarUrl: null, avatarURL: null,
      profileSelfieVideoURL: null, profileMediaRemoved: true,
    }, { merge: true })
    return
  }
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID()
    const finish = (error?: Error) => {
      window.clearTimeout(timeout)
      window.removeEventListener('poplur-profile-media-removal', receive)
      if (error) reject(error)
      else resolve()
    }
    const receive = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (detail?.requestId !== requestId) return
      finish(detail.ok ? undefined : new Error('Could not remove your picture. Try again.'))
    }
    const timeout = window.setTimeout(() => finish(new Error('Could not confirm removal. Check your connection and try again.')), 15_000)
    window.addEventListener('poplur-profile-media-removal', receive)
    if (!postNativeEvent({ type: 'removeProfileMedia', requestId })) {
      finish(new Error('Could not remove your picture. Try again.'))
    }
  })
}
