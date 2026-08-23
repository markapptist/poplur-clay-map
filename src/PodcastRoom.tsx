import React, { useCallback, useEffect, useState } from 'react'
import { readCharacter, onCharacterChange, defaultCharacter, type PoplurCharacter } from './characterStore'
import ClayCharacter from './ClayCharacter'
import { startBroadcast, stopBroadcast, isLive, onLiveStore } from './liveStore'
import { playPop } from './pop'
import styles from './PodcastRoom.module.css'

const MAX_VISIBLE_CHARACTERS = 20

export interface RoomParticipant {
  id: string
  displayName: string
  /** The wardrobe appearance; null wears the default clay body. */
  character: PoplurCharacter | null
  isHost: boolean
  isSpeaker: boolean
  distanceMi: number | null
}

export default function PodcastRoom() {
  const [character, setCharacter] = useState<PoplurCharacter | null>(readCharacter)
  const [recording, setRecording] = useState(false)
  const [live, setLive] = useState(isLive)
  const [participants, setParticipants] = useState<RoomParticipant[]>([])

  useEffect(() => onCharacterChange(() => setCharacter(readCharacter())), [])
  useEffect(() => onLiveStore(() => setLive(isLive())), [])

  const me: RoomParticipant = {
    id: 'self',
    displayName: 'You',
    character,
    isHost: true,
    isSpeaker: true,
    distanceMi: null,
  }

  const allParticipants = [me, ...participants]
  const visibleCount = Math.min(allParticipants.length, MAX_VISIBLE_CHARACTERS)
  const overflowCount = allParticipants.length - visibleCount
  const visible = allParticipants.slice(0, visibleCount)

  const toggleRecording = useCallback(() => {
    playPop()
    setRecording(r => !r)
  }, [])

  const toggleLive = useCallback(() => {
    playPop()
    if (live) {
      stopBroadcast()
    } else {
      startBroadcast(undefined)
    }
    setLive(!live)
  }, [live])

  const inviteFromRadius = useCallback(() => {
    playPop()
    window.dispatchEvent(new CustomEvent('poplur-podcast-invite'))
  }, [])

  return (
    <div className={styles.room}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          {live && (
            <>
              <span className={styles.liveDot} />
              <span className={styles.liveLabel}>Live</span>
            </>
          )}
          <span className={styles.count}>
            {allParticipants.length} in room
          </span>
        </div>
        <button
          type="button"
          className={live ? styles.liveToggleOn : styles.liveToggle}
          onClick={toggleLive}
        >
          {live ? 'End live' : 'Go live'}
        </button>
      </div>

      {/* Location */}
      <div className={styles.location}>
        <span className={styles.locationPin}>📍</span>
        <span>Broadcasting from your location</span>
      </div>

      {/* Character stage */}
      <div className={styles.stage}>
        {visible.map((p, i) => (
          <div
            key={p.id}
            className={`${styles.characterSlot} ${p.isHost ? styles.host : ''}`}
            style={characterPosition(i, visibleCount)}
          >
            <CharacterSprite
              character={p.character}
              isHost={p.isHost}
              isSpeaker={p.isSpeaker}
              size={p.isHost ? 96 : 64}
            />
            <span className={styles.charLabel}>
              {p.displayName}
              {p.isHost && <span className={styles.hostBadge}>Host</span>}
            </span>
            {p.distanceMi != null && (
              <span className={styles.distance}>{p.distanceMi.toFixed(1)} mi</span>
            )}
          </div>
        ))}

        {overflowCount > 0 && (
          <div className={styles.overflow}>
            <div className={styles.overflowBubble}>+{overflowCount}</div>
            <span className={styles.overflowLabel}>listening</span>
          </div>
        )}

        {/* Center mic */}
        <div className={styles.centerMic}>🎙️</div>

        {/* Invite button */}
        <button type="button" className={styles.inviteSlot} onClick={inviteFromRadius}>
          <div className={styles.invitePlus}>+</div>
          <span className={styles.inviteLabel}>Add from radius</span>
        </button>
      </div>

      {/* Controls */}
      <div className={styles.controls}>
        <button
          type="button"
          className={recording ? styles.recordBtnActive : styles.recordBtn}
          onClick={toggleRecording}
        >
          <div className={styles.recordDot} />
        </button>
        <button type="button" className={styles.inviteBtn} onClick={inviteFromRadius}>
          <span>👤+</span>
        </button>
      </div>
      <p className={styles.cubeHint}>Cube = mic</p>
    </div>
  )
}

function characterPosition(index: number, total: number): React.CSSProperties {
  if (total <= 1) return { alignSelf: 'center' }

  const hostCenter = 0.5
  if (index === 0) return { left: '50%', transform: 'translateX(-50%)' }

  const guestIndex = index - 1
  const guestTotal = total - 1
  const cols = Math.min(guestTotal, 4)
  const row = Math.floor(guestIndex / cols)
  const col = guestIndex % cols
  const spacing = 1 / (cols + 1)
  const x = spacing * (col + 1)

  return {
    left: `${x * 100}%`,
    transform: 'translateX(-50%)',
    top: row === 0 ? undefined : `${60 + row * 80}px`,
  }
}

function CharacterSprite({ character, isHost, isSpeaker, size }: {
  character: PoplurCharacter | null
  isHost: boolean
  isSpeaker: boolean
  size: number
}) {
  // Anyone without a wardrobe character wears the default clay body — blue
  // top for the host, grey for guests, so the room still reads who runs it.
  const worn = character ?? { ...defaultCharacter(), topColor: isHost ? '#378ADD' : '#888780' }
  return <ClayCharacter character={worn} height={size * 1.5} speaking={isSpeaker} />
}
