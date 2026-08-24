export type PoplurMapMode = '2d' | '3d'

const STORAGE_KEY = 'poplur.map.mode'

export function savedMapMode(): PoplurMapMode | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value === '2d' || value === '3d' ? value : null
  } catch {
    return null
  }
}

export function initialMapMode(): PoplurMapMode {
  // The shared renderer starts flat and only introduces its small 3D building
  // layer at close neighbourhood zoom. `3d` selects that adaptive renderer;
  // it does not re-enable the old globe/always-3D path.
  return '3d'
}

export function setMapMode(mode: PoplurMapMode): void {
  // Retained as a no-op compatibility seam for older callers. The shared map
  // has one adaptive low-power rendering policy.
  void mode
}
