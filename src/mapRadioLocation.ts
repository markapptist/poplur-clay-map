export interface MapRadioLocation { lat: number; lng: number }

export function readMapRadioLocation(value: unknown): MapRadioLocation | null {
  if (!value || typeof value !== 'object') return null
  const { latitude: lat, longitude: lng } = value as Record<string, unknown>
  return typeof lat === 'number' && typeof lng === 'number'
    && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? { lat, lng } : null
}

/** Selection is explicit; camera animation frames do not retune the station. */
export function publishMapRadioLocation(coords: readonly [number, number]): void {
  window.parent.postMessage({ type: 'poplur-map-radio-location', latitude: coords[1], longitude: coords[0] }, '*')
}
