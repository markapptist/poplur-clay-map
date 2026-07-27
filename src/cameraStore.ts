// What the camera has actually captured this session, and what the roll has
// selected. The viewfinder writes it, the roll reads and selects from it, and
// the home's channel buttons show the selection count — so it lives here
// rather than being threaded through three components.

export interface Capture {
  id: string
  kind: 'photo' | 'video'
  /** object URL (video) or data URL (photo) */
  src: string
  /** mm:ss, videos only */
  length?: string
  at: number
}

const captures: Capture[] = []
const selected = new Set<string>()
const listeners = new Set<() => void>()

const emit = () => listeners.forEach(fn => fn())

export function onCameraStore(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function listCaptures(): readonly Capture[] { return captures }

export function addCapture(capture: Omit<Capture, 'id' | 'at'>): Capture {
  // Newest first — the roll reads top-left as most recent, like Photos.
  const full: Capture = { ...capture, id: `cap-${captures.length}-${captures.length ? captures[0].at + 1 : 0}`, at: captures.length }
  captures.unshift(full)
  emit()
  return full
}

export function isSelected(id: string): boolean { return selected.has(id) }

export function toggleSelected(id: string): void {
  if (selected.has(id)) selected.delete(id)
  else selected.add(id)
  emit()
}

export function selectedCount(): number { return selected.size }

export function clearSelection(): void {
  if (!selected.size) return
  selected.clear()
  emit()
}
