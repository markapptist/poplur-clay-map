// The camera as a SCANNER: every object ML recognizes cashes in the radius
// that object holds across everyone else's posts, and the HUD number climbs
// with each find.
//
// WHY the number climbs per find instead of per frame: detection streams the
// same chair at 30fps, and a counter that rose on every frame would be a
// slot-machine, not a scanner. A scanner logs each DISTINCT find once — the
// session keeps a ledger of what it has already counted, and only a new kind
// of object moves the number.
//
// WHERE the per-object radius comes from: the real answer is a service query —
// "how much combined claim radius do posts featuring this object hold right
// now?" — which exists when the live data does (Aug 2026). Until then the
// values are a deterministic stand-in derived from the label itself, exactly
// like engagement.ts fakes its trickle: same shape, same pacing, same cost,
// so the surface is real today and the service slots in behind one function.
//
//   REAL  — host answers window 'poplur-object-radius' queries, or the
//           lookup below is swapped for the service call.
//   DEMO  — hash(label) → a stable km value. Deterministic ON PURPOSE: a
//           scanner that reads the same object differently twice feels broken.

export interface ScanFind {
  label: string
  radiusKm: number
}

type Listener = (totalKm: number, lastFind: ScanFind | null) => void

const found = new Map<string, number>()
let totalKm = 0
const listeners = new Set<Listener>()

/** People are identities, not scannable objects — the recognized-user flow
 *  (seenUser) already owns them, and double-counting a face as "+2km person"
 *  would be both wrong and creepy. */
const UNSCANNABLE = new Set(['person', 'face', 'people', 'man', 'woman', 'user'])

const canon = (label: string) => label.trim().toLowerCase()

/**
 * The radius an object class holds across other people's posts, in km.
 * Deterministic demo stand-in for the live-service query (see header).
 * Bands: everyday objects sit low, so a room-sweep reads in single digits per
 * find and a session lands in the tens — the same scale one good post claims.
 */
export function objectRadiusKm(label: string): number {
  const c = canon(label)
  let h = 0
  for (let i = 0; i < c.length; i += 1) h = (h * 31 + c.charCodeAt(i)) >>> 0
  // 0.4 .. 6.4 km, in 0.1 steps so totals stay tidy on the HUD.
  return Math.round((0.4 + (h % 60) / 10) * 10) / 10
}

/**
 * Feed the scanner one frame's detections. Returns the finds that are NEW this
 * session (usually none — the same objects stream frame after frame), after
 * updating the running total and notifying the HUD.
 */
export function recordScanDetections(labels: string[]): ScanFind[] {
  const fresh: ScanFind[] = []
  for (const raw of labels) {
    const label = canon(raw)
    if (!label || UNSCANNABLE.has(label) || found.has(label)) continue
    const radiusKm = objectRadiusKm(label)
    found.set(label, radiusKm)
    totalKm = Math.round((totalKm + radiusKm) * 10) / 10
    fresh.push({ label, radiusKm })
  }
  if (fresh.length) {
    const last = fresh[fresh.length - 1]
    listeners.forEach(fn => fn(totalKm, last))
  }
  return fresh
}

/** The session's running scan total, in km. */
export function scanTotalKm(): number { return totalKm }

/** Everything found this session, for any surface that wants the ledger. */
export function scanLedger(): ScanFind[] {
  return [...found.entries()].map(([label, radiusKm]) => ({ label, radiusKm }))
}

/**
 * New scanning session. Called when detection turns off or the camera tab is
 * left: a scanner re-reads the room when you come back, it does not remember
 * last week's chair.
 */
export function resetScan(): void {
  if (!found.size) return
  found.clear()
  totalKm = 0
  listeners.forEach(fn => fn(0, null))
}

export function onScan(fn: Listener): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
