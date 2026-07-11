import React, { useState } from 'react'
import styles from './ProfileTwin.module.css'
import { playPop } from './pop'

// Browser twin of the iOS Profile screen (ProfileView.swift). The app's profile
// sits on a LIGHT ground with the animated 3D Mark head in a cyan→magenta
// gradient squircle, USERNAME below, a small speaking equaliser, and the
// Media / Messages mode switcher with a cyan underline. Kept from the earlier
// twin per the user: the poplur wordmark up top and the channel-number tiles.

const CHANNELS = ['CH 24', 'CH 83', 'CH 12', 'CH 07', 'CH 51', 'CH 09']

const MESSAGES = [
  { who: 'Poplur AI', text: 'Your radius grew 1.2 km near Queen West.', when: '2m' },
  { who: 'kensington_eats', text: 'that shawarma shot is trending 🔥', when: '18m' },
  { who: 'harbourfront', text: 'blue hour meetup this Friday?', when: '1h' },
]

export default function ProfileTwin() {
  const [mode, setMode] = useState<'media' | 'messages'>('media')

  return (
    <section className={styles.profile}>
      <div className={styles.header}>
        <div className={styles.avatarWrap} onClick={() => playPop()}>
          <div className={styles.avatarFrame} />
          <img className={styles.head} src="mark_head.png" alt="" draggable="false" />
        </div>

        <div className={styles.speaking} aria-hidden="true">
          <span /><span /><span /><span /><span />
        </div>

        <h1 className={styles.username}>USERNAME</h1>

        <div className={styles.modeSwitch}>
          <button
            type="button"
            className={mode === 'media' ? styles.modeOn : styles.mode}
            onClick={() => setMode('media')}
          >
            Media
            <i />
          </button>
          <button
            type="button"
            className={mode === 'messages' ? styles.modeOn : styles.mode}
            onClick={() => setMode('messages')}
          >
            Messages
            <i />
          </button>
        </div>
      </div>

      <div className={styles.content}>
        {mode === 'media' ? (
          <div className={styles.grid}>
            {CHANNELS.map(ch => (
              <span key={ch} className={styles.tile}>{ch}</span>
            ))}
          </div>
        ) : (
          <div className={styles.messages}>
            {MESSAGES.map(m => (
              <div key={m.who} className={styles.msgRow}>
                <div className={styles.msgAvatar}>{m.who[0].toUpperCase()}</div>
                <div className={styles.msgBody}>
                  <div className={styles.msgTop}>
                    <strong>{m.who}</strong>
                    <span>{m.when}</span>
                  </div>
                  <p>{m.text}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
