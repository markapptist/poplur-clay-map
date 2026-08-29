import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { homeSurfaceIsVisible, mapGlobeSpinIsActive } from '../mapThermalPolicy'
import HoldMenuContentGate from '../HoldMenuContentGate'

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('map thermal policy', () => {
  it('uses the native lifecycle as the authority in the iOS shell', () => {
    expect(homeSurfaceIsVisible(true, false, true)).toBe(false)
    expect(homeSurfaceIsVisible(true, true, false)).toBe(true)
  })

  it('uses document visibility outside the iOS shell', () => {
    expect(homeSurfaceIsVisible(false, false, true)).toBe(true)
    expect(homeSurfaceIsVisible(false, true, false)).toBe(false)
  })

  it('ends the globe turn at its deadline while leaving eligibility unchanged', () => {
    expect(mapGlobeSpinIsActive(true, 9_999, 10_000)).toBe(true)
    expect(mapGlobeSpinIsActive(true, 10_000, 10_000)).toBe(false)
    expect(mapGlobeSpinIsActive(false, 1, 10_000)).toBe(false)
  })

  it('parks the central governor and unmounts held heavy content while WebKit still says visible', async () => {
    const fakeWindow = new EventTarget() as EventTarget & Record<string, unknown>
    fakeWindow.location = { protocol: 'https:' }

    const fakeDocument = new EventTarget() as EventTarget & Record<string, unknown>
    fakeDocument.hidden = false
    fakeDocument.visibilityState = 'visible'
    fakeDocument.documentElement = { dataset: {} }

    vi.stubGlobal('window', fakeWindow)
    vi.stubGlobal('document', fakeDocument)
    vi.stubGlobal('navigator', {
      deviceMemory: 4,
      hardwareConcurrency: 6,
      userAgent: 'Vitest',
      platform: 'test',
      maxTouchPoints: 0,
    })

    vi.doMock('../frameGovernor', () => ({
      currentQuality: () => 3,
      onQualityChange: () => () => {},
      setMemoryPressure: vi.fn(),
      setPowerSavingMode: vi.fn(),
    }))
    vi.doMock('../PoplurAssetCache', () => ({
      poplurAssetCache: {
        configure: vi.fn(),
        diagnostics: () => ({ estimatedBytes: 0, limitBytes: 0, count: 0 }),
        trimToFraction: vi.fn(),
        purge: vi.fn(),
      },
    }))
    vi.doMock('../nativeBridge', () => ({
      isIOSNativeShell: () => false,
      isNativeShell: () => false,
    }))

    const { PoplurPerformanceManager } = await import('../poplurPerformanceManager')
    const rendererStates: boolean[] = []
    PoplurPerformanceManager.registerRenderer({
      id: 'held-heavy-test',
      onActiveChange: active => rendererStates.push(active),
    })
    expect(PoplurPerformanceManager.snapshot.isForeground).toBe(true)
    expect(rendererStates[rendererStates.length - 1]).toBe(true)

    fakeWindow.dispatchEvent(new CustomEvent('poplur-native-app-lifecycle', {
      detail: { active: false },
    }))

    expect(fakeDocument.visibilityState).toBe('visible')
    expect(fakeDocument.hidden).toBe(false)
    expect(PoplurPerformanceManager.snapshot.isForeground).toBe(false)
    expect(rendererStates[rendererStates.length - 1]).toBe(false)

    // A late/stale WebKit visibility notification must not wake the governor
    // after the native host has declared itself authoritative.
    fakeDocument.dispatchEvent(new Event('visibilitychange'))
    expect(PoplurPerformanceManager.snapshot.isForeground).toBe(false)

    const parkedMarkup = renderToStaticMarkup(
      React.createElement(
        HoldMenuContentGate,
        { active: PoplurPerformanceManager.snapshot.isForeground },
        React.createElement('iframe', {
          title: 'heavy held screen',
          src: 'https://example.test/heavy',
        }),
      ),
    )
    expect(parkedMarkup).toContain('data-poplur-hold-menu-parked="true"')
    expect(parkedMarkup).not.toContain('<iframe')

    fakeWindow.dispatchEvent(new CustomEvent('poplur-native-app-lifecycle', {
      detail: { active: true },
    }))
    expect(PoplurPerformanceManager.snapshot.isForeground).toBe(true)

    const resumedMarkup = renderToStaticMarkup(
      React.createElement(
        HoldMenuContentGate,
        { active: PoplurPerformanceManager.snapshot.isForeground },
        React.createElement('iframe', {
          title: 'heavy held screen',
          src: 'https://example.test/heavy',
        }),
      ),
    )
    expect(resumedMarkup).toContain('<iframe')
  })
})
