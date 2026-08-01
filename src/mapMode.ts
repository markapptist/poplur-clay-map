export type PoplurMapMode = '2d' | '3d'

const STORAGE_KEY = 'poplur.map.mode'

type RuntimeHints = {
  __POPLUR_MAP_MODE__?: PoplurMapMode
}

export function savedMapMode(): PoplurMapMode | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value === '2d' || value === '3d' ? value : null
  } catch {
    return null
  }
}

export function initialMapMode(): PoplurMapMode {
  if (typeof window === 'undefined') return '2d'
  const hints = window as typeof window & RuntimeHints
  const query = new URLSearchParams(window.location.search).get('mapMode')
  const queryMode = query === '2d' || query === '3d' ? query : null
  return queryMode ?? hints.__POPLUR_MAP_MODE__ ?? savedMapMode() ?? '2d'
}

export function setMapMode(mode: PoplurMapMode): void {
  try { window.localStorage.setItem(STORAGE_KEY, mode) } catch { /* private WebView */ }
}
