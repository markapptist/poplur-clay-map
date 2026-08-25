import { describe, expect, it } from 'vitest'
import { ownsMainSurface, ownsMapSurface } from '../screenOwnership'

describe('exclusive heavy screen ownership', () => {
  const activeMap = {
    mapMounted: true,
    activeTab: 'map',
    committedTab: 'map',
    surfaceVisible: true,
    subscreenRequested: false,
    permissionOpen: false,
  }

  it('mounts Mapbox only while Map owns both semantic and committed state', () => {
    expect(ownsMapSurface(activeMap)).toBe(true)
    expect(ownsMapSurface({ ...activeMap, activeTab: 'feed' })).toBe(false)
    expect(ownsMapSurface({ ...activeMap, committedTab: 'feed' })).toBe(false)
  })

  it('removes Mapbox for a subscreen, permission cover, background, or teardown', () => {
    expect(ownsMapSurface({ ...activeMap, subscreenRequested: true })).toBe(false)
    expect(ownsMapSurface({ ...activeMap, permissionOpen: true })).toBe(false)
    expect(ownsMapSurface({ ...activeMap, surfaceVisible: false })).toBe(false)
    expect(ownsMapSurface({ ...activeMap, mapMounted: false })).toBe(false)
  })

  it('unmounts the root heavy tree before a transition or subscreen commit', () => {
    const main = {
      surfaceVisible: true,
      subscreenRequested: false,
      permissionOpen: false,
      switchingScreens: false,
    }
    expect(ownsMainSurface(main)).toBe(true)
    expect(ownsMainSurface({ ...main, switchingScreens: true })).toBe(false)
    expect(ownsMainSurface({ ...main, subscreenRequested: true })).toBe(false)
    expect(ownsMainSurface({ ...main, permissionOpen: true })).toBe(false)
    expect(ownsMainSurface({ ...main, surfaceVisible: false })).toBe(false)
  })
})
