// Firebase for the plain browser.
//
// On a phone the web runs inside the native shell, which owns Firebase and
// relays every read/write for the page. A desktop browser tab has no such
// shell, so to place and receive calls there — sign in, find who is nearby,
// reach the `calls/` rendezvous — the page needs its own Firebase. This is that
// client. It is only ever used when there is NO native bridge; inside the app
// the native path still owns identity and data.
//
// Config values are the project's own, read from the Android google-services
// file (project poplur2025). The apiKey/authDomain/projectId are what auth and
// Firestore need; they are not secrets (they ship in every client).

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  type Auth, type User,
} from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: 'AIzaSyDbDM14RX9pIBk4NB-paCArt_7UZBt6OYM',
  authDomain: 'poplur2025.firebaseapp.com',
  projectId: 'poplur2025',
  storageBucket: 'poplur2025.firebasestorage.app',
  messagingSenderId: '440480901104',
  appId: '1:440480901104:android:d1ec34c59249c1fd8c1f35',
}

let app: FirebaseApp | null = null
let authRef: Auth | null = null
let dbRef: Firestore | null = null

function ensure(): { auth: Auth; db: Firestore } {
  if (!app) app = getApps()[0] ?? initializeApp(firebaseConfig)
  if (!authRef) authRef = getAuth(app)
  if (!dbRef) dbRef = getFirestore(app)
  return { auth: authRef, db: dbRef }
}

export function webDb(): Firestore {
  return ensure().db
}

export function webAuth(): Auth {
  return ensure().auth
}

export function currentUid(): string | null {
  return ensure().auth.currentUser?.uid ?? null
}

export function currentDisplayName(): string | null {
  const u = ensure().auth.currentUser
  return u?.displayName ?? (u?.email ? u.email.split('@')[0] : null)
}

export function onUser(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(ensure().auth, cb)
}

export async function webSignIn(email: string, password: string): Promise<User> {
  const { user } = await signInWithEmailAndPassword(ensure().auth, email, password)
  return user
}

export function webSignOut(): Promise<void> {
  return signOut(ensure().auth)
}
