// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { filterOrdinal, nextZoomPreset, stepFilterId, zoomReadout } from '../cameraStepper'
import ClayArrowCluster from '../ClayArrowCluster'

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

  it('renders the cluster: the filter above and below, the lens left and right', () => {
    // The six-row column this used to be is the shared four-way cluster now.
    // The camera's two jobs and both readouts survived the move: the filter is
    // the vertical axis with its number above it, the lens the horizontal one
    // with the zoom between the arrows that change it.
    // JSX permits data-* on any element; createElement's typed props do not,
    // so the fixture is cast exactly where the screens use plain JSX.
    const html = renderToStaticMarkup(createElement(ClayArrowCluster, {
      size: 176,
      'data-camera-step': '',
      'data-camera-step-filter': 3,
      topLabel: '3',
      topTitle: 'Anaglyph',
      label: '1.4×',
      upLabel: 'Next filter',
      downLabel: 'Previous filter',
      leftLabel: 'Zoom out',
      rightLabel: 'Zoom in',
      onUp: () => {},
      onDown: () => {},
      onLeft: () => {},
      onRight: () => {},
    } as unknown as Parameters<typeof ClayArrowCluster>[0]))
    expect(html).toContain('data-camera-step=""')
    expect(html).toContain('data-camera-step-filter="3"')
    expect(html).toContain('Up: Next filter')
    expect(html).toContain('Down: Previous filter')
    expect(html).toContain('data-poplur-gesture-navigation')
    expect(html).not.toContain('data-cluster-arrow')
    expect(html).toContain('3 · 1.4×')
  })
})
