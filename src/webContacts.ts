// Real, callable people for the browser phone.
//
// On a phone the native address book (requestPhoneContacts) fills the reach
// list with real uids. A plain browser has none of that, so the phone falls
// back to the world board — but those are display-only pops with made-up ids,
// so "calling" one reaches nobody. Once the browser tab is signed in, this
// pulls REAL recent posters from Firestore: their uid is the actual account id,
// so dialling them opens a `calls/` doc the real person's tab is watching.
//
// This is deliberately simpler than PoplurPhoneContacts (no favourites/DMs/
// strict reach ranking yet) — enough to call a real person from the web. The
// richer ranking can follow once the basic web↔web path is proven.

import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore'
import { webDb, currentUid } from './webFirebase'

export interface WebContact {
  id: string
  handle: string
  detail: string
  callable: boolean
}

export async function fetchWebContacts(): Promise<WebContact[]> {
  const uid = currentUid()
  if (!uid) return []
  const seen = new Map<string, WebContact>()
  try {
    const snap = await getDocs(
      query(collection(webDb(), 'posts'), orderBy('createdAt', 'desc'), limit(120)),
    )
    snap.forEach(docSnap => {
      const data = docSnap.data() as Record<string, unknown>
      const owner = (data.userID as string) ?? (data.userId as string) ?? ''
      if (!owner || owner === uid || seen.has(owner)) return
      const name = (data.username as string) ?? owner.slice(0, 8)
      seen.set(owner, {
        id: owner,
        handle: name.startsWith('@') ? name : `@${name}`,
        detail: 'ON POPLUR · CALLABLE',
        callable: true,
      })
    })
  } catch (err) {
    console.warn('[webContacts] query failed', err)
  }
  return [...seen.values()].slice(0, 40)
}
