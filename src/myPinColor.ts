import { PIN_COLOR_IDS, PIN_COLOR_SWATCH, pinColorId, type PinColorId } from './pinColors'
import { resetTakeoverColor, setTakeoverColor } from './takeoverColor'

/**
 * YOUR pin colour — one identity worn by every pop you hold.
 *
 * A pop document carries the colour it was posted with, which is right for
 * other people's pins: their colour is their identity. It was wrong for your
 * own board, where pops posted on different days wore different colours and
 * nothing tied them to you. Your pins now read this one value instead, so the
 * board answers "which of these are mine" at a glance.
 *
 * The same value drives the takeover hue, which is what the terrain, the
 * claims and the zoom rail are painted from. Setting it here is therefore the
 * only way the three can be changed, and they cannot drift apart: pick a
 * colour and the pins, the ground under them and the rail all move together.
 */
const STORAGE_KEY = 'poplur.pin.color.v1'

function read(): PinColorId | null {
  try { return pinColorId(window.localStorage.getItem(STORAGE_KEY)) } catch { return null }
}

let current: PinColorId | null = typeof window === 'undefined' ? null : read()
const listeners = new Set<(color: PinColorId | null) => void>()

/** Push the choice into the takeover palette, then tell the map. */
function publish(): void {
  // No choice means the original pink pin, and the house pink everywhere else.
  if (current) setTakeoverColor(PIN_COLOR_SWATCH[current])
  else resetTakeoverColor()
  for (const listener of [...listeners]) listener(current)
}

/** The colour every pin you own is wearing, or null for the original pink. */
export function myPinColor(): PinColorId | null {
  return current
}

/** Choose a colour. Anything unrecognised means the original pink. */
export function setMyPinColor(value: unknown): PinColorId | null {
  const next = pinColorId(value)
  if (next === current) return current
  current = next
  try {
    if (next) window.localStorage.setItem(STORAGE_KEY, next)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch { /* private mode: the choice still holds for this session */ }
  publish()
  return current
}

/**
 * The colour badge: take one of the OTHER supplied pins, never the one already
 * worn, so every press visibly changes the board.
 */
export function randomizeMyPinColor(): PinColorId {
  const others = PIN_COLOR_IDS.filter(id => id !== current)
  const next = others[Math.floor(Math.random() * others.length)]
  setMyPinColor(next)
  return next
}

/** Paint the stored choice at boot, so the rail and ground start on the same
 *  colour as the pins rather than on the house pink. */
export function applyMyPinColor(): void {
  current = read()
  publish()
}

export function onMyPinColor(listener: (color: PinColorId | null) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
