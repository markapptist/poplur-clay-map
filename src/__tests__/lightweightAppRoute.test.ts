import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')

describe('lightweight application routing', () => {
  it('loads the Map application only for the internal map route', () => {
    const app = source('App.tsx')
    const map = source('MapApp.tsx')

    expect(app).toContain("React.lazy(() => import('./MapApp'))")
    expect(app).toContain("params.get('map') === '1'")
    expect(app.indexOf("params.get('map') === '1'")).toBeLessThan(app.indexOf('harnessViewFromLocation()'))
    expect(app).not.toContain("from 'mapbox-gl'")
    expect(map).toContain("from 'mapbox-gl'")
  })

  it('keeps Map-only polling and data controllers out of the shell module', () => {
    const app = source('App.tsx')

    expect(app).not.toContain('WEATHER_REFRESH_MS')
    expect(app).not.toContain('useLiveNews()')
    expect(app).not.toContain('startRadioForMap')
    expect(app).not.toContain('setInterval')
    expect(app).toContain('startEngagementChips()')

    const home = source('HomeTwin.tsx')
    expect(home).toContain("import WeatherMark from './WeatherMark'")
    expect(home).not.toContain("from './ClayMap'")
  })

  it('does not turn the shell stylesheet import into a Mapbox JavaScript preload', () => {
    const vite = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8')

    expect(vite).toContain("id.includes('mapbox-gl') && !id.includes('.css')")
  })
})
