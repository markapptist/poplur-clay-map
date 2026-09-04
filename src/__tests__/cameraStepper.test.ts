import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { filterOrdinal, nextZoomPreset, stepFilterId, zoomReadout } from '../cameraStepper'
import CameraStepControls from '../CameraStepControls'

const PRESETS = [0.5, 1, 2] as const

describe("the camera's stepper", () => {
  it('steps the lens presets from the nearest one and wraps at both ends', () => {
    expect(nextZoomPreset(1, 1, PRESETS)).toBe(2)
    expect(nextZoomPreset(1, -1, PRESETS)).toBe(0.5)
    expect(nextZoomPreset(2, 1, PRESETS)).toBe(0.5)
    expect(nextZoomPreset(0.5, -1, PRESETS)).toBe(2)
    // A pinched 1.4× is nearest 1×: stepping in lands on 2×, never back on 1×.
    expect(nextZoomPreset(1.4, 1, PRESETS)).toBe(2)
    expect(nextZoomPreset(1.4, -1, PRESETS)).toBe(0.5)
    expect(nextZoomPreset(3, 1, [])).toBe(3)
  })

  it('steps filters like channels: up is the higher ordinal, wrapping, unknown starts at the first', () => {
    const ids = ['none', 'glow', 'anaglyph', 'hood']
    expect(stepFilterId(ids, 'none', 1)).toBe('glow')
    expect(stepFilterId(ids, 'none', -1)).toBe('hood')
    expect(stepFilterId(ids, 'hood', 1)).toBe('none')
    expect(stepFilterId(ids, 'missing', 1)).toBe('glow')
    expect(filterOrdinal(ids, 'anaglyph')).toBe(3)
    expect(filterOrdinal(ids, 'missing')).toBe(1)
  })

  it('says the zoom the way the preset chips do, with a decimal between presets', () => {
    expect(zoomReadout(0.5)).toBe('.5×')
    expect(zoomReadout(1)).toBe('1×')
    expect(zoomReadout(2)).toBe('2×')
    expect(zoomReadout(1.4)).toBe('1.4×')
    expect(zoomReadout(2.95)).toBe('3×')
    expect(zoomReadout(2.94)).toBe('2.9×')
    expect(zoomReadout(Number.NaN)).toBe('1×')
  })

  it('renders the feed-shaped block: filter up, the number, filter down, zoom out, the zoom, zoom in', () => {
    const html = renderToStaticMarkup(createElement(CameraStepControls, {
      side: 'left',
      filterNumber: 3,
      filterLabel: 'Anaglyph',
      zoomLabel: '1.4×',
      onFilterUp: () => {},
      onFilterDown: () => {},
      onZoomStep: () => {},
      onZoomHold: () => {},
    }))
    expect(html).toContain('data-camera-step=""')
    expect(html).toContain('data-camera-step-filter="3"')
    expect(html).toContain('aria-label="Next filter"')
    expect(html).toContain('aria-label="Previous filter"')
    expect(html).toContain('data-camera-step-zoom="out"')
    expect(html).toContain('data-camera-step-zoom="in"')
    expect(html.indexOf('data-camera-step-zoom="out"')).toBeLessThan(html.indexOf('data-camera-step-zoom-label=""'))
    expect(html.indexOf('data-camera-step-zoom-label=""')).toBeLessThan(html.indexOf('data-camera-step-zoom="in"'))
    expect(html).toContain('>3</span>')
    expect(html).toContain('>1.4×</span>')
  })
})
