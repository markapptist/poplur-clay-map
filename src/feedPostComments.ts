import { useEffect, useState } from 'react'
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { webDb } from './webFirebase'

export function useFeedPostComments(postId: string | undefined, active: boolean) {
  const [state, setState] = useState<{ key: string; rows: { uid: string; who: string; body: string; pic: string; mine: boolean }[] }>({ key: '', rows: [] })
  const key = postId?.replace(/^firestore:/, '') ?? ''
  useEffect(() => {
    if (!active || !key || key.includes('/')) return
    return onSnapshot(query(collection(webDb(), 'posts', key, 'comments'), orderBy('createdAt', 'desc'), limit(30)), snapshot => {
      setState({ key, rows: snapshot.docs.flatMap(doc => {
        const row = doc.data()
        if (typeof row.text !== 'string') return []
        return [{ uid: String(row.actorUid ?? ''), who: String(row.handle || '@tester'), body: row.text.slice(0, 500), pic: 'logo_icon.png', mine: false }]
      }) })
    }, () => setState({ key, rows: [] }))
  }, [active, key])
  return state.key === key ? state.rows : []
}
