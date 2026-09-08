import React, { useState } from 'react'
import bakedControls from './sharedClayControls.json'
import './sharedClayControls.css'

/**
 * Browser activation policy shared by the baked and prism button shells.
 *
 * Normal clay controls act on primary pointer-down so a parent gesture surface
 * cannot swallow the delayed click. The click generated after that pointer is
 * deliberately ignored. Keyboard and assistive button activation arrives as a
 * click with detail 0 and must still act exactly once. A few controls opt into
 * click activation because their press unmounts the surface; those defer the
 * pointer action to its detail > 0 click while using the same keyboard path.
 */
export function clayCornerActivationHandlers({
  activateOnClick,
  onPress,
  onPulse,
}: {
  activateOnClick: boolean
  onPress: () => void
  onPulse?: () => void
}) {
  return {
    onPointerDown(event: { isPrimary: boolean; button: number }) {
      if (!event.isPrimary || event.button !== 0) return
      onPulse?.()
      if (!activateOnClick) onPress()
    },
    onClick(event: { detail: number }) {
      if (event.detail === 0) {
        onPulse?.()
        onPress()
      } else if (activateOnClick) {
        onPress()
      }
    },
  }
}

export default function ClayCornerButton({
  kind,
  active = false,
  label,
  onPress,
  size = 44,
  activateOnClick = false,
  tone = 'clay',
  prism = false,
}: {
  kind: 'flash' | 'flip' | 'close' | 'share' | 'link' | 'send' | 'capture' | 'mail' | 'search' | 'locate'
    | 'heart' | 'thumbUp' | 'thumbDown' | 'comment' | 'comments' | 'play' | 'seekBack' | 'seekFwd'
    | 'roll' | 'live' | 'delete' | 'block'
  active?: boolean
  label: string
  onPress: () => void
  size?: number
  /** Use click for controls that unmount their surface, preventing pointer-through. */
  activateOnClick?: boolean
  /** 'cream' moulds the object in white clay, for light grounds. */
  tone?: 'clay' | 'cream'
  /** Retained for callers; baked controls have no idle rendering loop. */
  still?: boolean
  /** The faceted isometric-prism shell — the same recipe as the camera's
   *  Scan/AR buttons — for controls whose content wants a badge-like frame
   *  instead of a bare floating shape. */
  prism?: boolean
}) {
  const [failed, setFailed] = useState(false)
  const FLAT_GLYPH: Partial<Record<typeof kind, string>> = {
    close: '✕', flash: '⚡', flip: '⟳', share: '↑', link: '🔗',
    send: '➤', capture: '◉', mail: '✉', search: '⌕', locate: '◎',
    comment: '◌', comments: '•••', heart: '♥', thumbUp: '👍', thumbDown: '👎',
    roll: '▤', live: '⦿', delete: '⌫', block: '⊘',
  }


  const activationHandlers = clayCornerActivationHandlers({ activateOnClick, onPress })
  if (prism) {
    // The camera's Scan/AR shell, generalised: a true isometric prism (top
    // face + two side edges, clay-pink gradients) carrying a small glyph on
    // its face instead of the sphere/"AR" text those two use.
    const flipped = kind === 'thumbDown'
    const gid = (n: string) => `prism${n}-${kind}`
    return (
      <button
        type="button"
        aria-label={label}
        onPointerDown={activationHandlers.onPointerDown}
        onClick={activationHandlers.onClick}
        style={{ position: 'relative', width: size, height: size, border: 0, padding: 0, background: 'transparent', cursor: 'pointer' }}
      >
        <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true"
          style={{ display: 'block', filter: 'drop-shadow(0 3px 4px rgba(0,0,0,.62))' }}>
          <defs>
            <linearGradient id={gid('Face')} x1="0" y1="0" x2="1" y2="1">
              <stop stopColor="#ffb3d7" /><stop offset=".46" stopColor="#f24c9c" /><stop offset="1" stopColor="#8d124d" />
            </linearGradient>
            <linearGradient id={gid('Edge')} x1="0" y1="0" x2="0" y2="1">
              <stop stopColor="#a81558" /><stop offset="1" stopColor="#510725" />
            </linearGradient>
          </defs>
          <path d="M9 35 24 43 39 35 24 28Z" fill="rgba(0,0,0,.42)" />
          <path d="M8 16v19l16 9V25Z" fill={`url(#${gid('Edge')})`} />
          <path d="M40 16v19l-16 9V25Z" fill={`url(#${gid('Edge')})`} />
          <path d="M24 5 40 14 24 25 8 14Z" fill={`url(#${gid('Face')})`} />
          <g transform="translate(24,14) scale(.5) translate(-12,-12)">
            <g transform={flipped ? 'rotate(180 12 12)' : undefined}>
              <path d="M9 21H5.6a1.6 1.6 0 0 1-1.6-1.6v-7.8A1.6 1.6 0 0 1 5.6 10H9m0 11V10l3.15-6.08A1.8 1.8 0 0 1 15.55 4l-.7 6H19a2 2 0 0 1 1.98 2.28l-1.06 6.9A2 2 0 0 1 17.94 21H9Z" fill="#fff1f8" stroke="#8e174d" strokeWidth="1.25" strokeLinejoin="round" />
            </g>
          </g>
          <path d="M24 5 40 14 24 25 8 14Z" fill="none" stroke="rgba(20,4,12,.55)" strokeWidth="1" />
          <path d="M8 14v21l16 9 16-9V14M24 25v19" fill="none" stroke="rgba(20,4,12,.4)" strokeWidth="1" />
        </svg>
      </button>
    )
  }

  return (
    <div className="poplur-baked-control" style={{ position: 'relative', width: size, height: size, pointerEvents: 'auto' }}>
      {failed ? <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', height: '100%', color: tone === 'cream' ? '#fff2e4' : '#ff8ac6', fontSize: size * .5 }}>{FLAT_GLYPH[kind] ?? '●'}</span>
        : <img src={(bakedControls as Record<string, string>)[`${kind}|${active}|${tone}`]} alt="" draggable={false} onError={() => setFailed(true)} />}
      <button
        type="button"
        aria-label={label}
        aria-pressed={kind === 'flash' || kind === 'heart' || kind === 'comments' || kind === 'live' || kind === 'play' || kind === 'search' ? active : undefined}
        onPointerDown={activationHandlers.onPointerDown}
        onClick={activationHandlers.onClick}
        style={{ position: 'absolute', inset: 0, background: 'transparent', border: 0, cursor: 'pointer', padding: 0 }}
      />
    </div>
  )
}
