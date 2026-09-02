import { describe, expect, it } from 'vitest'
import {
  BREAKING_NEWS_CUBE_MODEL,
  BROWSER_CUBE_MODEL,
  FEED_TV_CUBE_MODEL,
  FOG_CUBE_MODEL,
  HAIL_CUBE_MODEL,
  HOME_CUBE_MODEL,
  SNOW_CUBE_MODEL,
  WIND_CUBE_MODEL,
  isBreakingNewsCubeEvent,
  mapContextCubeModel,
  readMapNewsCubeEvent,
  weatherCubeKind,
  weatherCubeModel,
} from '../contextCubeModels'

describe('context cube models', () => {
  it('maps the supplied home and browser models to stable bundle-root URLs', () => {
    expect(HOME_CUBE_MODEL).toBe('poplur_cube_home.glb')
    expect(FEED_TV_CUBE_MODEL).toBe('clay_tv.glb')
    expect(BROWSER_CUBE_MODEL).toBe('poplur_cube_at_sign.glb')
  })

  it('uses distinct supplied clouds for snow and hail', () => {
    expect(weatherCubeKind('snow')).toBe('snow')
    expect(weatherCubeKind('hail')).toBe('hail')
    expect(weatherCubeModel(weatherCubeKind('snow'))).toBe(SNOW_CUBE_MODEL)
    expect(weatherCubeModel(weatherCubeKind('hail'))).toBe(HAIL_CUBE_MODEL)
    expect(weatherCubeKind('storm')).toBe('thunder')
    expect(weatherCubeKind('clear')).toBeNull()
  })

  it('uses the supplied fog cloud for fog, above any wind reading', () => {
    expect(weatherCubeKind('fog')).toBe('fog')
    expect(weatherCubeKind('fog', true)).toBe('fog')
    expect(weatherCubeModel('fog')).toBe(FOG_CUBE_MODEL)
  })

  it('never takes the cube for wind, however hard it blows', () => {
    // Wind sits above the advisory bar for hours, so a wind cube was a cube
    // that never changed back. Only falling weather takes the navigator now.
    expect(weatherCubeKind('clear', true)).toBeNull()
    expect(weatherCubeKind('cloudy', true)).toBeNull()
    expect(weatherCubeKind('clear', false)).toBeNull()
    expect(weatherCubeKind('cloudy')).toBeNull()
    // Precipitation is unaffected, windy or not.
    expect(weatherCubeKind('rain', true)).toBe('rain')
    expect(weatherCubeKind('storm', true)).toBe('thunder')
    // The supplied wind artwork is still addressable if it is ever wanted.
    expect(weatherCubeModel('wind')).toBe(WIND_CUBE_MODEL)
  })

  it('lets an active breaking-news stop outrank ambient weather', () => {
    expect(mapContextCubeModel(true, 'snow')).toBe(BREAKING_NEWS_CUBE_MODEL)
    expect(mapContextCubeModel(false, 'hail')).toBe(HAIL_CUBE_MODEL)
    expect(mapContextCubeModel(false, null)).toBeNull()
  })

  it('reserves the breaking-news cube for breaking and live stories', () => {
    expect(isBreakingNewsCubeEvent({ id: 'b', status: 'breaking' })).toBe(true)
    expect(isBreakingNewsCubeEvent({ id: 'l', status: 'live' })).toBe(true)
    expect(isBreakingNewsCubeEvent({ id: 'd', status: 'developing' })).toBe(false)
    expect(isBreakingNewsCubeEvent({ id: 't', status: 'top' })).toBe(false)
    expect(isBreakingNewsCubeEvent(null)).toBe(false)
  })

  it('validates the stable active-story signal and treats clear as inactive', () => {
    expect(readMapNewsCubeEvent({
      type: 'poplur-map-news-event',
      active: true,
      id: 'breaking-42',
      status: 'breaking',
    })).toEqual({ id: 'breaking-42', status: 'breaking' })
    expect(readMapNewsCubeEvent({ active: false, id: null, status: null })).toBeNull()
    expect(readMapNewsCubeEvent({ active: true, id: 'x', status: 'invented' })).toBeNull()
  })
})
