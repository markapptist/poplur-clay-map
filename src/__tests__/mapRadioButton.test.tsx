import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import MapRadioButton from '../MapRadioButton'

const source = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')

describe('MapRadioButton', () => {
  it('uses the supplied radio artwork for an inactive Map control', () => {
    const html = renderToStaticMarkup(<MapRadioButton active={false} onPress={() => {}} />)

    expect(html).toContain('data-poplur-side-icon="media.radio"')
    expect(html).toContain('data-map-radio-toggle=""')
    expect(html).toContain('aria-label="Turn on Poplur Radio on the map"')
    expect(html).toContain('aria-pressed="false"')
  })

  it('announces the stop action while Radio is active', () => {
    const html = renderToStaticMarkup(<MapRadioButton active onPress={() => {}} />)

    expect(html).toContain('aria-label="Turn off Poplur Radio on the map"')
    expect(html).toContain('aria-pressed="true"')
  })

  it('wires both real Map rails locally without forcing native Map fallback', () => {
    const app = source('MapApp.tsx')
    const home = source('HomeTwin.tsx')
    const radio = source('mapRadio.ts')

    expect(app).toContain('<MapRadioButton')
    expect(home).toContain('<MapRadioButton')
    expect(app).toContain('startRadioForMap(navigationOrigin[1], navigationOrigin[0])')
    expect(home).toContain('startRadioForMap(location.lat, location.lng)')
    expect(home).not.toContain("sendMapAction('radio')")
    expect(radio).toContain('startMapRadio({ mediaOnly: true })')
    expect(radio).toContain('listLocalRadioStations(lat, lng, 120_000, signal)')
    expect(radio).toContain("playStation(station, 'map')")
  })

  it('mounts the now-playing label directly in both Map title stacks', () => {
    const app = source('MapApp.tsx')
    const home = source('HomeTwin.tsx')

    expect(app).toContain('<MapRadioStatusLabel className={styles.mapRadioLabel} />')
    expect(home).toContain('<MapRadioStatusLabel className={styles.mapRadioLabel} />')
    expect(app).not.toContain('className={styles.areaPops}')
    // The area count moved inside the place card, so it now precedes the radio
    // label in source order. What this test actually guards is that the label is
    // mounted DIRECTLY in the title stack — never nested inside the card.
    const cardStart = home.indexOf('<span key={mapPlace} className={styles.mapTitleText}>')
    const cardEnd = home.indexOf('</span>', cardStart)
    const radioAt = home.indexOf('<MapRadioStatusLabel')
    expect(cardStart).toBeGreaterThan(-1)
    expect(radioAt).toBeGreaterThan(cardEnd)
  })
})
