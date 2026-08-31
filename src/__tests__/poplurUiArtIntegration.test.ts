import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')

describe('supplied Poplur UI art integration', () => {
  it('puts each media control only on a surface with matching live behavior', () => {
    const feed = source('FeedTwin.tsx')
    const radio = source('RadioScreen.tsx')
    const tv = source('TVGuide.tsx')

    expect(feed).toContain('icon="media.pause"')
    expect(feed).toContain('onActivate={togglePlayback}')
    expect(radio).toContain('icon="media.radio"')
    expect(radio).toContain('icon="media.volume"')
    expect(radio).toContain("setUserMuted(next)")
    expect(tv).toContain('icon="media.tv"')
    expect(tv).toContain('icon="media.volume"')
    expect(tv).toContain("setUserMuted(next)")
  })

  it('keeps sample card copy out of the live weather and status components', () => {
    const weather = source('ClayMap.tsx')
    const status = source('PoplurStatusToast.tsx')

    expect(weather).toContain('data-poplur-weather-update')
    expect(weather).toContain('WEATHER UPDATE')
    expect(`${weather}\n${status}`).not.toContain('Rain in 12 min')
    expect(`${weather}\n${status}`).not.toContain('Reaching more people')
  })

  it('uses only the supplied semantic weather asset registry', () => {
    const weatherMark = source('WeatherMark.tsx')
    const weatherSources = [
      source('MapApp.tsx'),
      source('HomeTwin.tsx'),
      source('ClayMap.tsx'),
      weatherMark,
      source('weatherPresentation.ts'),
    ].join('\n')

    expect(weatherMark).toContain('SideControlIconImage')
    expect(weatherMark).toContain('weatherIconIdForMode')
    expect(weatherSources).not.toContain('weatherIconForMode')
    expect(weatherSources).not.toContain('cloudBadge')
    expect(weatherSources).not.toContain('weatherCloud')
    expect(weatherSources).not.toContain('poplur-weather-glyphs')
    expect(existsSync(new URL('../../public/weather/poplur-weather-glyphs.png', import.meta.url))).toBe(false)
  })
})
