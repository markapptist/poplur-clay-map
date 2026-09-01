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

  it('uses the restored committed fog asset without reviving the rejected weather sheet', () => {
    const weatherMark = source('WeatherMark.tsx')
    const weatherTextMark = source('weatherTextMark.ts')
    const clayMap = source('ClayMap.tsx')
    const weatherSources = [
      source('MapApp.tsx'),
      source('HomeTwin.tsx'),
      clayMap,
      weatherMark,
      source('weatherPresentation.ts'),
    ].join('\n')

    expect(weatherMark).toContain('approvedWeatherAssetId(mode, iconId)')
    expect(weatherMark).toContain('icon={approvedAsset}')
    expect(weatherMark).toContain('styles.weatherVisualProvidedAsset')
    expect(weatherMark).not.toContain('weatherIconIdForMode')
    expect(weatherTextMark).toContain("? 'weather.fog' : null")
    expect(weatherTextMark).toContain("'weather.cloudy': 'CLOUD'")
    expect(weatherTextMark).toContain("'weather.partly_cloudy': 'PART'")
    const sticker = clayMap.slice(
      clayMap.indexOf('function WeatherSticker'),
      clayMap.indexOf('// One cross-platform renderer'),
    )
    expect(sticker).toContain('approvedWeatherAssetId(mode, iconId)')
    expect(sticker).toContain('icon={approvedAsset}')
    expect(sticker).toContain('styles.weatherStickerProvidedAsset')
    expect(sticker).not.toContain('weatherIconIdForMode')
    expect(weatherSources).not.toContain('weatherIconForMode')
    expect(weatherSources).not.toContain('cloudBadge')
    expect(weatherSources).not.toContain('weatherCloud')
    expect(weatherSources).not.toContain('poplur-weather-glyphs')
    expect(existsSync(new URL('../../public/weather/poplur-weather-glyphs.png', import.meta.url))).toBe(false)
  })

  it('renders the approved fog artwork without a molded badge background', () => {
    const css = source('ClayMap.module.css')
    const assetShell = css.slice(
      css.indexOf('.weatherStickerProvidedAsset'),
      css.indexOf('.weatherHeroSticker'),
    )

    expect(assetShell).toContain('.weatherVisualProvidedAsset')
    expect(assetShell).toContain('overflow: visible')
    expect(assetShell).toContain('border: 0')
    expect(assetShell).toContain('background: transparent')
    expect(assetShell).toContain('box-shadow: none')
  })

  it('keeps condition text and temperature as the truthful fallback outside fog', () => {
    const home = source('HomeTwin.tsx')
    const map = source('MapApp.tsx')
    const css = source('ClayMap.module.css')

    expect(`${home}\n${map}`).toContain('<WeatherMark')
    expect(`${home}\n${map}`).toContain('formatWeatherTemperature')
    expect(css).toContain('.weatherTextMark')
    expect(css).toContain('.weatherStickerText')
    expect(css).toContain('.weatherProvidedAsset')
  })
})
