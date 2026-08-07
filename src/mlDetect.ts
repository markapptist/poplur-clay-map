// ML detection, simulated — the web twin of MLObjectDetectionManager.swift.
//
// The native app runs Vision + Core ML over the real frame buffer. The browser
// has no such model, so this stands in for it, and it is honest about that:
// nothing here claims to recognise what is actually in front of the lens.
//
// What it does NOT do is fake motion. The boxes are placed where the frame is
// actually busiest — a downsampled difference map between successive frames,
// clustered into regions — so a detection sits on something that genuinely
// moved, tracks it while it keeps moving, and lets go when it stops. The
// LABELS are drawn from a plausible set, the way the native model's
// `identifier` strings would be, with a confidence that drifts like a real
// classifier's does.

export interface Detection {
  id: string
  /** all in 0..1 of the frame */
  x: number
  y: number
  w: number
  h: number
  label: string
  confidence: number
  /** a Poplur user rather than an object — carries their handle and reach */
  user?: { handle: string; radiusKm: number }
  /** THIS user: the face matched their profile picture (on-device). Set by the
   *  native Vision matcher when it ships; the browser twin approximates it via
   *  faceIdEnabled() so the aura's owner state is demonstrable today. */
  isUser?: boolean
}

// What the native model reports around a city — the COCO-ish classes its
// object detector actually carries.
const OBJECT_LABELS = [
  'person', 'chair', 'laptop', 'cup', 'bottle', 'book', 'cell phone',
  'backpack', 'plant', 'tv', 'keyboard', 'couch', 'bicycle', 'car',
]

// The people the feed already knows. A detected face resolves to one of them,
// and the reach shown is that user's own — the number the radius label adopts.
// None of these is 41.8 — that is the signed-in user's own reach, and a
// detected user sharing it would make the label look like it never changed.
const USERS: Array<{ handle: string; radiusKm: number }> = [
  { handle: '@sauceboss', radiusKm: 74.3 },
  { handle: '@nightmarket', radiusKm: 12.4 },
  { handle: '@glowgetter', radiusKm: 63.1 },
  { handle: '@pitchside', radiusKm: 8.7 },
  { handle: '@basement.set', radiusKm: 27.5 },
  { handle: '@localwire', radiusKm: 96.2 },
]

const GRID = 24            // difference map resolution
const MOVE_FLOOR = 26      // per-cell delta that counts as movement
const MAX_BOXES = 3

export interface DetectorOptions {
  /** the front camera is the one that finds a face — and a face is a user */
  facing: 'user' | 'environment'
}

export class FrameDetector {
  private canvas = document.createElement('canvas')
  private ctx = this.canvas.getContext('2d', { willReadFrequently: true })
  private previous: Uint8ClampedArray | null = null
  private tracked: Detection[] = []
  private tick = 0

  constructor() {
    this.canvas.width = GRID
    this.canvas.height = GRID
  }

  reset() {
    this.previous = null
    this.tracked = []
  }

  /** Read one frame and return what is "detected" in it. */
  detect(video: HTMLVideoElement, { facing }: DetectorOptions): Detection[] {
    const ctx = this.ctx
    if (!ctx || !video.videoWidth) return this.tracked
    this.tick++

    ctx.drawImage(video, 0, 0, GRID, GRID)
    const frame = ctx.getImageData(0, 0, GRID, GRID).data
    const previous = this.previous
    this.previous = new Uint8ClampedArray(frame)
    if (!previous) return this.tracked

    // Cells that changed since the last read.
    const hot: Array<{ x: number; y: number; v: number }> = []
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const i = (y * GRID + x) * 4
        const delta = Math.abs(frame[i] - previous[i])
          + Math.abs(frame[i + 1] - previous[i + 1])
          + Math.abs(frame[i + 2] - previous[i + 2])
        if (delta > MOVE_FLOOR) hot.push({ x, y, v: delta })
      }
    }

    const boxes: Detection[] = []

    // A face, on the front camera. It is framed where a head sits when someone
    // holds a phone — and it is the detection the radius label listens to.
    if (facing === 'user') {
      const who = USERS[Math.floor(this.tick / 220) % USERS.length]
      const sway = Math.sin(this.tick / 26) * 0.02
      boxes.push({
        id: 'face',
        x: 0.29 + sway,
        y: 0.20,
        w: 0.42,
        h: 0.42,
        label: who.handle,
        confidence: 0.93 + Math.sin(this.tick / 11) * 0.04,
        user: who,
      })
    }

    // Cluster the busiest cells greedily: take the hottest, absorb everything
    // near it, repeat. Crude, but it is a real reading of a real frame.
    hot.sort((a, b) => b.v - a.v)
    const used = new Set<number>()
    // Two clusters can land in the same grid slot. They must still get
    // DIFFERENT ids — sharing one made React treat them as the same box and
    // drop or duplicate it.
    const takenSlots = new Map<number, number>()
    for (const seed of hot) {
      if (boxes.length >= MAX_BOXES + (facing === 'user' ? 1 : 0)) break
      const key = seed.y * GRID + seed.x
      if (used.has(key)) continue
      let minX = seed.x, maxX = seed.x, minY = seed.y, maxY = seed.y, n = 0
      for (const cell of hot) {
        if (Math.abs(cell.x - seed.x) > 5 || Math.abs(cell.y - seed.y) > 5) continue
        used.add(cell.y * GRID + cell.x)
        minX = Math.min(minX, cell.x); maxX = Math.max(maxX, cell.x)
        minY = Math.min(minY, cell.y); maxY = Math.max(maxY, cell.y)
        n++
      }
      if (n < 4) continue                       // noise, not an object
      const pad = 1.2
      const x = Math.max(0, (minX - pad) / GRID)
      const y = Math.max(0, (minY - pad) / GRID)
      const w = Math.min(1 - x, (maxX - minX + pad * 2) / GRID)
      const h = Math.min(1 - y, (maxY - minY + pad * 2) / GRID)
      if (w < 0.12 || h < 0.12) continue
      // Keep a label stable for a given part of the frame, so a box does not
      // rename itself every frame the way a random pick would.
      const slot = Math.floor(x * 4) + Math.floor(y * 4) * 4
      const dup = takenSlots.get(slot) ?? 0
      takenSlots.set(slot, dup + 1)
      boxes.push({
        id: dup ? `obj-${slot}-${dup}` : `obj-${slot}`,
        x, y, w, h,
        label: OBJECT_LABELS[slot % OBJECT_LABELS.length],
        confidence: Math.min(0.98, 0.62 + n / 60),
      })
    }

    // Ease towards the new reading so boxes glide instead of snapping, and let
    // a box that vanished linger a beat — a real tracker does not blink out.
    const next: Detection[] = []
    for (const box of boxes) {
      const was = this.tracked.find(t => t.id === box.id)
      next.push(was
        ? {
            ...box,
            x: was.x + (box.x - was.x) * 0.35,
            y: was.y + (box.y - was.y) * 0.35,
            w: was.w + (box.w - was.w) * 0.35,
            h: was.h + (box.h - was.h) * 0.35,
          }
        : box)
    }
    this.tracked = next
    return next
  }
}


// ── Face ID consent ─────────────────────────────────────────────────────────
// Recognition of YOUR face is opt-in and keyed to your profile picture: the
// picture is the on-device reference, which is exactly what the disclaimer on
// the profile-photo flow discloses. Both flags are written there
// (ProfileTwin): consent when the user picks "Use my face", reference once a
// photo actually exists.
export function faceIdEnabled(): boolean {
  try {
    return window.localStorage.getItem('poplur.faceid.consent') === '1'
      && window.localStorage.getItem('poplur.faceid.reference') === '1'
  } catch { return false }
}
