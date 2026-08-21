import { useEffect, useState } from 'react'
import styles from './WebSignIn.module.css'
import { isNativeShell } from './nativeBridge'
import { onUser, webSignIn, webSignOut, currentDisplayName } from './webFirebase'
import { playPop } from './pop'

// Sign-in for the plain browser only.
//
// Inside the app you are already authenticated by the native shell, so this
// never shows there. On the dev server there is no session, and calling needs
// an identity (a uid to be the caller/callee and to watch `calls/`). This is a
// small, non-blocking affordance — the rest of the web app stays usable signed
// out; only calling needs it — that signs the browser tab into the same
// Firebase project the phones use, so a tab and a phone can call each other.

export default function WebSignIn() {
  const [signedIn, setSignedIn] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isNativeShell()) return
    return onUser(user => setSignedIn(user ? (currentDisplayName() ?? 'signed in') : null))
  }, [])

  // Never render inside the native app — native owns identity there.
  if (isNativeShell()) return null

  if (signedIn) {
    return (
      <div className={styles.pill}>
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.who}>{signedIn}</span>
        <button type="button" className={styles.link} onClick={() => { playPop(); void webSignOut() }}>
          Sign out
        </button>
      </div>
    )
  }

  if (!open) {
    return (
      <button type="button" className={styles.pill} onClick={() => { playPop(); setOpen(true) }}>
        <span className={`${styles.dot} ${styles.dotOff}`} aria-hidden="true" />
        Sign in to call
      </button>
    )
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      await webSignIn(email.trim(), password)
      setOpen(false); setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Firebase:\s*/, '') : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={styles.card} onSubmit={submit}>
      <div className={styles.title}>Sign in to call</div>
      <input
        className={styles.input} type="email" placeholder="Email" autoComplete="username"
        value={email} onChange={e => setEmail(e.target.value)} disabled={busy} required
      />
      <input
        className={styles.input} type="password" placeholder="Password" autoComplete="current-password"
        value={password} onChange={e => setPassword(e.target.value)} disabled={busy} required
      />
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.row}>
        <button type="button" className={styles.ghost} onClick={() => { playPop(); setOpen(false); setError('') }} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className={styles.go} disabled={busy}>
          {busy ? '…' : 'Sign in'}
        </button>
      </div>
    </form>
  )
}
