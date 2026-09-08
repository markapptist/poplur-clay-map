import React from 'react'
import bakedControls from './sharedClayControls.json'
import './sharedClayControls.css'

export default function ClayMuteButton({
  muted,
  onToggle,
  size = 40,
}: {
  muted: boolean
  onToggle: () => void
  size?: number
}) {
  return (
    <div className="poplur-baked-control" style={{ position: 'relative', width: size, height: size, pointerEvents: 'auto' }}>
      <img src={(bakedControls as Record<string, string>)[`mute|${muted}|clay`]} alt="" draggable={false} />
      <button
        type="button"
        aria-label={muted ? 'Unmute sound' : 'Mute sound'}
        aria-pressed={muted}
        onPointerDown={event => { if (event.isPrimary && event.button === 0) onToggle() }}
        onClick={event => { if (event.detail === 0) onToggle() }}
        style={{ position: 'absolute', inset: 0, background: 'transparent', border: 0, cursor: 'pointer', padding: 0 }}
      />
    </div>
  )
}
