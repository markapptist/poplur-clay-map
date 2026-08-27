import SideControlIconButton from './SideControlIcon'
import { SIDE_CONTROL_ICONS } from './sideControlIcons'
import { playPop } from './pop'

/** Shared channel controls using the approved side-button artwork directly. */
export default function ClayChannelArrows({
  number,
  label,
  dot = false,
  onUp,
  onDown,
  upLabel = SIDE_CONTROL_ICONS['global.channel_up'].accessibilityLabel,
  downLabel = SIDE_CONTROL_ICONS['global.channel_down'].accessibilityLabel,
  size = 176,
  orientation = 'vertical',
  single,
}: {
  number: number
  label?: string
  dot?: boolean
  onUp: () => void
  onDown: () => void
  upLabel?: string
  downLabel?: string
  size?: number
  orientation?: 'vertical' | 'horizontal'
  single?: 'up' | 'down'
}) {
  const horizontal = orientation === 'horizontal'
  const boxW = single ? Math.round(size / 2) : horizontal ? size : Math.round(size / 2)
  const boxH = single ? Math.round(size / 2) : horizontal ? Math.round(size / 2) : size
  const imageSize = Math.round(Math.min(boxW, boxH) * (single ? 1.34 : horizontal ? 1.18 : 1.08))
  const activate = (handler: () => void) => { playPop(); handler() }
  const buttonStyle = (direction: 'up' | 'down') => ({
    position: 'absolute' as const,
    display: 'grid',
    placeItems: 'center',
    top: single || horizontal || direction === 'up' ? 0 : undefined,
    bottom: !single && !horizontal && direction === 'down' ? 0 : undefined,
    left: single || !horizontal || direction === 'up' ? 0 : undefined,
    right: !single && horizontal && direction === 'down' ? 0 : undefined,
    // The supplied horizontal arrow images are wider than their visual clay
    // core. Half-width hit regions made the left/right faces nearly touch at
    // the centre. Keep full 48px+ targets but pull their centres outward so
    // the pair reads as two deliberate channel buttons, not one fused control.
    width: single ? '100%' : horizontal ? '32%' : '100%',
    height: single ? '100%' : horizontal ? '100%' : '50%',
    margin: 0,
    padding: 0,
    border: 0,
    background: 'transparent',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  })
  const imageStyle = {
    width: imageSize,
    height: imageSize,
    transform: horizontal ? 'rotate(-90deg)' : undefined,
  }

  return (
    <div
      style={{ position: 'relative', width: boxW, height: boxH, pointerEvents: 'auto' }}
      data-poplur-channel-arrows=""
    >
      {/* Keep the recovery watchdog contract without creating a WebGL context. */}
      <span
        aria-hidden="true"
        data-poplur-channel-renderer="ready"
        style={{ position: 'absolute', inset: 0, display: 'block', pointerEvents: 'none' }}
      />

      {single !== 'down' && (
        <SideControlIconButton
          icon="global.channel_up"
          imageSize={imageSize}
          imageStyle={imageStyle}
          data-poplur-channel-control="up"
          aria-label={upLabel}
          style={buttonStyle('up')}
          onActivate={() => activate(onUp)}
        />
      )}

      {!single && (
        <span
          style={{
            position: 'absolute',
            top: '50%',
            left: 0,
            right: 0,
            zIndex: 1,
            transform: 'translateY(-50%)',
            textAlign: 'center',
            fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
            fontSize: 15,
            fontWeight: 900,
            color: '#4dff69',
            textShadow: '0 0 8px rgba(77,255,105,0.5), 0 2px 4px rgba(0,0,0,0.8)',
            pointerEvents: 'none',
          }}
        >
          {label ?? number}
        </span>
      )}

      {dot && !single && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            zIndex: 2,
            width: 12,
            height: 12,
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            background: 'radial-gradient(circle at 34% 26%, #ffd4dc 0 8%, #ff5b72 24%, #e20f35 64%, #8c001b 100%)',
            border: '1px solid rgba(255, 206, 216, 0.75)',
            boxShadow: 'inset 1px 1px 2px rgba(255,255,255,0.75), inset -2px -2px 3px rgba(91,0,18,0.55), 0 3px 4px rgba(0,0,0,0.65), 0 0 9px rgba(255,45,75,0.75)',
            animation: 'poplurRecBlink 1s steps(1, end) infinite',
            pointerEvents: 'none',
          }}
        />
      )}

      {single !== 'up' && (
        <SideControlIconButton
          icon="global.channel_down"
          imageSize={imageSize}
          imageStyle={imageStyle}
          data-poplur-channel-control="down"
          aria-label={downLabel}
          style={buttonStyle('down')}
          onActivate={() => activate(onDown)}
        />
      )}
    </div>
  )
}
