import { useCallback, useEffect, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { authoredPostsSnapshot, type AuthoredPostRow, type AuthoredPostsSnapshot } from './authoredPosts'
import { isNativeShell, postNativeEvent } from './nativeBridge'
import { webDb } from './webFirebase'

export const AUTHORED_POSTS_EVENT = 'poplur-authored-posts'
let nextSubscription = 0
type State = { uid: string | null; snapshot: AuthoredPostsSnapshot | null; error: boolean }

/** Active-screen-only author subscription. Native Firebase owns phone reads;
 * the browser uses the identical uncapped userID query. Requests are keyed so
 * a previous profile's late callback can never become the next user's total. */
export function useAuthoredPosts(uid: string | null, enabled = true) {
  const [state, setState] = useState<State>({ uid: null, snapshot: null, error: false })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!uid || !enabled) return
    let active = true
    let stop: (() => void) | null = null
    let generation = 0
    let nativeActive = (window as Window & { __poplurNativeAppActive?: boolean }).__poplurNativeAppActive !== false
    const park = () => { generation++; stop?.(); stop = null }
    const start = () => {
      if (stop || document.hidden || !nativeActive || !active) return
      const current = ++generation
      const accept = (rows: AuthoredPostRow[]) => {
        if (active && current === generation) setState({ uid, snapshot: authoredPostsSnapshot(uid, rows), error: false })
      }
      const fail = () => {
        if (active && current === generation) setState(previous => ({ uid,
          snapshot: previous.uid === uid ? previous.snapshot : null, error: true }))
      }
      if (isNativeShell()) {
        const subscriptionId = `author-${Date.now()}-${++nextSubscription}`
        let timeout = window.setTimeout(fail, 20_000)
        const receive = (event: Event) => {
          const detail = (event as CustomEvent).detail
          if (detail?.subscriptionId !== subscriptionId || detail?.uid !== uid) return
          window.clearTimeout(timeout)
          if (detail.error || !Array.isArray(detail.documents)) { fail(); return }
          accept(detail.documents.filter((item: unknown): item is AuthoredPostRow => Boolean(item && typeof item === 'object'
            && typeof (item as AuthoredPostRow).id === 'string' && (item as AuthoredPostRow).row
            && typeof (item as AuthoredPostRow).row === 'object')))
        }
        window.addEventListener(AUTHORED_POSTS_EVENT, receive)
        stop = () => {
          window.clearTimeout(timeout)
          window.removeEventListener(AUTHORED_POSTS_EVENT, receive)
          postNativeEvent({ type: 'stopAuthoredPosts', subscriptionId })
        }
        if (!postNativeEvent({ type: 'watchAuthoredPosts', subscriptionId, userId: uid })) fail()
      } else {
        const timeout = window.setTimeout(fail, 20_000)
        try {
          const unsubscribe = onSnapshot(query(collection(webDb(), 'posts'), where('userID', '==', uid)), { includeMetadataChanges: true }, snapshot => {
            // A new author's local Firestore cache may contain only the Feed
            // window. Wait for the server's complete query before calling it a total.
            if (snapshot.metadata.fromCache) return
            window.clearTimeout(timeout)
            accept(snapshot.docs.map(document => ({ id: document.id, row: document.data() })))
          }, () => { window.clearTimeout(timeout); fail() })
          stop = () => { window.clearTimeout(timeout); unsubscribe() }
        } catch { window.clearTimeout(timeout); fail() }
      }
    }
    const visibility = () => { if (document.hidden || !nativeActive) park(); else start() }
    const lifecycle = (event: Event) => {
      const value = (event as CustomEvent).detail?.active
      if (typeof value === 'boolean') { nativeActive = value; park(); visibility() }
    }
    setState({ uid, snapshot: null, error: false })
    start()
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('poplur-native-app-lifecycle', lifecycle)
    return () => {
      active = false; park()
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('poplur-native-app-lifecycle', lifecycle)
    }
  }, [uid, enabled, revision])
  const current = enabled && state.uid === uid ? state : { uid, snapshot: null, error: false }
  return { ...current, loading: Boolean(uid && enabled && !current.snapshot && !current.error),
    retry: useCallback(() => setRevision(value => value + 1), []) }
}
