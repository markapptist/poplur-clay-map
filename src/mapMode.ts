export type PoplurMapMode = '2d' | '3d'

const STORAGE_KEY = 'poplur.map.mode'
const NOTICE_KEY = 'poplur.map.2d-notice.seen'

type RuntimeHints = {
  __POPLUR_MAP_MODE__?: PoplurMapMode
  __POPLUR_MAP_FALLBACK__?: boolean
}

export function savedMapMode(): PoplurMapMode | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value === '2d' || value === '3d' ? value : null
  } catch {
    return null
  }
}

export function deviceNeeds2DMap(): boolean {
  if (typeof window === 'undefined') return false
  const hints = window as typeof window & RuntimeHints
  if (hints.__POPLUR_MAP_FALLBACK__) return true
  if (new URLSearchParams(window.location.search).get('fallback2d') === '1') return true
  const nav = navigator as Navigator & { deviceMemory?: number }
  const lowMemory = typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 3
  const lowCpu = typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency <= 4
  return lowMemory || lowCpu
}

export function initialMapMode(): PoplurMapMode {
  if (typeof window === 'undefined') return '3d'
  const hints = window as typeof window & RuntimeHints
  const query = new URLSearchParams(window.location.search).get('mapMode')
  const queryMode = query === '2d' || query === '3d' ? query : null
  return queryMode ?? hints.__POPLUR_MAP_MODE__ ?? savedMapMode() ?? (deviceNeeds2DMap() ? '2d' : '3d')
}

export function isAutomatic2DFallback(): boolean {
  return initialMapMode() === '2d' && savedMapMode() == null && deviceNeeds2DMap()
}

export function setMapMode(mode: PoplurMapMode): void {
  try { window.localStorage.setItem(STORAGE_KEY, mode) } catch { /* private WebView */ }
}

export function shouldShow2DNotice(): boolean {
  if (!isAutomatic2DFallback()) return false
  try { return window.localStorage.getItem(NOTICE_KEY) !== '1' } catch { return true }
}

export function mark2DNoticeSeen(): void {
  try { window.localStorage.setItem(NOTICE_KEY, '1') } catch { /* private WebView */ }
}
