import React, { useCallback, useEffect, useMemo, useState } from 'react'
import styles from './PhoneScreen.module.css'
import { OTHER_POPS } from './data'
import { RADIUS_CHANGE_EVENT, radiusKm } from './radiusLedger'
import { reachBetween, reachState, type Reach, type ReachState } from './reach'
import { playPop } from './pop'

// The Poplur phone.
//
// Who you can call is a radius question, and it has TWO answers, because
// everyone carries their own radius:
//
//   you can call them   — they stand inside YOUR radius
//   they can call you   — you stand inside THEIRS
//
// Those are independent. A pop with a 320km reach can ring you from another
// city while your own reach falls a long way short of them, and the phone has
// to show that rather than flattening it into one "nearby" list. So the first
// screen IS this: everyone, sorted by how open the line is, with both
// directions on every row.

interface Contact {
  id: string
  handle: string
  place: string
  color: string
  avatar: string
  /** their own reach, which is what decides whether they can ring you */
  theirRadiusKm: number
  reach: Reach
  state: ReachState
}

/** Most open line first. Within a group, whoever is closest. */
const GROUP_ORDER: ReachState[] = ['both', 'outgoing', 'incoming', 'none']

const GROUP_LABEL: Record<ReachState, string> = {
  both: 'OPEN BOTH WAYS',
  outgoing: 'YOU CAN CALL',
  incoming: 'THEY CAN CALL YOU',
  none: 'OUT OF REACH',
}

function useContacts(reachKm: number): Contact[] {
  return useMemo(() => {
    const contacts = OTHER_POPS.map(pop => {
      const reach = reachBetween(pop.coords, pop.radiusKm, reachKm)
      return {
        id: pop.id,
        handle: pop.user,
        place: pop.name,
        color: pop.color,
        avatar: pop.avatar,
        theirRadiusKm: pop.radiusKm,
        reach,
        state: reachState(reach),
      }
    })
    return contacts.sort((a, b) => {
      const group = GROUP_ORDER.indexOf(a.state) - GROUP_ORDER.indexOf(b.state)
      return group !== 0 ? group : a.reach.distanceKm - b.reach.distanceKm
    })
  }, [reachKm])
}

function km(value: number): string {
  return value >= 100 ? `${Math.round(value)} km` : `${value.toFixed(1)} km`
}

export default function PhoneScreen({ onClose }: { onClose?: () => void }) {
  const [reachKm, setReachKm] = useState(() => radiusKm())
  const [calling, setCalling] = useState<Contact | null>(null)

  // Reach is live: spend or earn radius anywhere in the app and the lines that
  // are open change here without reopening the phone.
  useEffect(() => {
    const sync = () => setReachKm(radiusKm())
    window.addEventListener(RADIUS_CHANGE_EVENT, sync)
    return () => window.removeEventListener(RADIUS_CHANGE_EVENT, sync)
  }, [])

  const contacts = useContacts(reachKm)

  const dial = useCallback((contact: Contact) => {
    // Only the outgoing direction opens a call. Someone who can reach YOU is
    // not someone you can reach, and the row says so rather than dialling into
    // nothing.
    if (!contact.reach.youCanCall) return
    playPop()
    setCalling(contact)
  }, [])

  const hangUp = useCallback(() => { playPop(); setCalling(null) }, [])

  // The cube is the way out of every subscreen; Escape is its keyboard twin.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (calling) hangUp()
      else onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [calling, hangUp, onClose])

  let lastGroup: ReachState | null = null

  return (
    <div className={styles.screen} data-poplur-screen="profile-phone" aria-label="Poplur phone">
      <div className={styles.head}>
        <div className={styles.title}>Phone</div>
        <div className={styles.reach}>
          your reach <span className={styles.reachValue}>{km(reachKm)}</span>
          {' · '}
          {contacts.filter(c => c.reach.youCanCall).length} you can call
          {' · '}
          {contacts.filter(c => c.reach.theyCanCall).length} can call you
        </div>
        <div className={styles.key} aria-hidden="true">
          <span className={styles.keyItem}><b className={styles.dirOn}>→</b> you can call</span>
          <span className={styles.keyItem}><b className={styles.dirOn}>←</b> they can call you</span>
        </div>
      </div>

      <div className={styles.list} data-clay-scroll>
        {contacts.map(contact => {
          const header = contact.state !== lastGroup ? GROUP_LABEL[contact.state] : null
          lastGroup = contact.state
          const { youCanCall, theyCanCall, distanceKm } = contact.reach
          return (
            <React.Fragment key={contact.id}>
              {header && <div className={styles.groupLabel}>{header}</div>}
              <button
                type="button"
                className={contact.state === 'none' ? `${styles.row} ${styles.rowNone}` : styles.row}
                style={{ ['--who' as string]: contact.color }}
                onClick={() => dial(contact)}
                disabled={!youCanCall}
                aria-label={`${contact.handle}, ${GROUP_LABEL[contact.state].toLowerCase()}`}
              >
                <img className={styles.face} src={contact.avatar} alt="" draggable={false} />
                <span className={styles.who}>
                  <span className={styles.handle}>{contact.handle}</span>
                  <span className={styles.where}>{contact.place} · {km(distanceKm)} away</span>
                  {/* What the shortfall actually is, per direction — the number
                      you would have to close to open the line. */}
                  {!youCanCall && (
                    <span className={styles.gap}>
                      {km(distanceKm - reachKm)} more reach to call them
                    </span>
                  )}
                </span>
                <span className={styles.dirs}>
                  <span className={`${styles.dir} ${youCanCall ? styles.dirOn : styles.dirOff}`}>
                    <b>→</b>
                  </span>
                  <span className={`${styles.dir} ${theyCanCall ? styles.dirOn : styles.dirOff}`}>
                    <b>←</b>
                  </span>
                </span>
              </button>
            </React.Fragment>
          )
        })}
      </div>

      {calling && (
        <div className={styles.call} role="dialog" aria-label={`Calling ${calling.handle}`}>
          <img
            className={`${styles.callFace} ${styles.ringing}`}
            style={{ ['--who' as string]: calling.color }}
            src={calling.avatar}
            alt=""
            draggable={false}
          />
          <div className={styles.callWho}>{calling.handle}</div>
          <div className={styles.callState}>
            {calling.reach.theyCanCall ? 'RINGING · OPEN BOTH WAYS' : 'RINGING · ONE WAY'}
          </div>
          <div className={styles.callNote}>
            {calling.place} is {km(calling.reach.distanceKm)} away, inside your {km(reachKm)} reach.
            {calling.reach.theyCanCall
              ? ' They can reach you too.'
              : ` Their own reach is ${km(calling.theirRadiusKm)}, so they cannot ring you back yet.`}
          </div>
          {/* Said plainly rather than mimed: the radius rules are real, the
              voice link is not wired to anything yet. */}
          <div className={styles.callNote}>Voice is not connected yet — this is the line, not the call.</div>
          <button type="button" className={styles.hang} onClick={hangUp}>End</button>
        </div>
      )}
    </div>
  )
}
