/** null means unlimited; malformed legacy values remain unlimited. */
export function photoViewSeconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(60, Math.max(1, Math.round(value))) : null
}

export function mediaTimeLabel(seconds: number | null): string {
  if (seconds === null) return '∞'
  const remaining = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`
}

/** Visit all eligible posts, largest radius first, before beginning another pass. */
export function nextRadiusPost<T extends { id: string; reachKm?: number; demo?: boolean; createdAtMillis?: number }>(
  candidates: readonly T[], watched: Set<string>, currentId?: string,
): T | undefined {
  if (currentId) watched.add(currentId)
  const ordered = [...candidates].sort((a, b) =>
    Number(Boolean(a.demo)) - Number(Boolean(b.demo))
    || (b.reachKm ?? 0) - (a.reachKm ?? 0)
    || (b.createdAtMillis ?? 0) - (a.createdAtMillis ?? 0)
    || a.id.localeCompare(b.id))
  let next = ordered.find(post => !watched.has(post.id))
  if (!next) {
    watched.clear()
    if (currentId) watched.add(currentId)
    next = ordered.find(post => post.id !== currentId)
  }
  return next
}
