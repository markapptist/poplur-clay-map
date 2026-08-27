export interface NativeMapWeatherVisibility {
  nativeAdaptiveMap: boolean
  webFallback: boolean
  activeTab: string
  committedTab: string
  surfaceVisible: boolean
  subscreenRequested: boolean
  permissionOpen: boolean
}

/** The native iPhone map has no App.tsx tree of its own, so Home must host the
 * weather layer while MapKit is the visible renderer. Keep the predicate pure
 * and explicit: effects stop as soon as another full screen or permission UI
 * takes ownership, and the web fallback continues using App.tsx's layer. */
export function nativeMapWeatherVisible({
  nativeAdaptiveMap,
  webFallback,
  activeTab,
  committedTab,
  surfaceVisible,
  subscreenRequested,
  permissionOpen,
}: NativeMapWeatherVisibility): boolean {
  return nativeAdaptiveMap
    && !webFallback
    && activeTab === 'map'
    && committedTab === 'map'
    && surfaceVisible
    && !subscreenRequested
    && !permissionOpen
}
