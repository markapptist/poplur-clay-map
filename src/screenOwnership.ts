export interface MainSurfaceOwnership {
  surfaceVisible: boolean
  subscreenRequested: boolean
  permissionOpen: boolean
  switchingScreens: boolean
}

export function ownsMainSurface({
  surfaceVisible,
  subscreenRequested,
  permissionOpen,
  switchingScreens,
}: MainSurfaceOwnership): boolean {
  return surfaceVisible && !subscreenRequested && !permissionOpen && !switchingScreens
}

export interface MapSurfaceOwnership {
  mapMounted: boolean
  activeTab: string
  committedTab: string
  surfaceVisible: boolean
  subscreenRequested: boolean
  permissionOpen: boolean
}

/** The Mapbox document may exist only while Map is the exclusive main owner. */
export function ownsMapSurface({
  mapMounted,
  activeTab,
  committedTab,
  surfaceVisible,
  subscreenRequested,
  permissionOpen,
}: MapSurfaceOwnership): boolean {
  return mapMounted
    && activeTab === 'map'
    && committedTab === 'map'
    && surfaceVisible
    && !subscreenRequested
    && !permissionOpen
}
