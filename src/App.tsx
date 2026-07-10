import React, { useRef, useState, useCallback, useEffect } from 'react'
import mapboxgl from 'mapbox-gl'
import '@google/model-viewer'
import { POIS, MAP_THEMES } from './data'
import ClayMap from './ClayMap'
import TopChrome from './TopChrome'
import WeatherFX, { modeForCode } from './WeatherFX'
import type { WeatherMode } from './WeatherFX'
import styles from './App.module.css'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, unknown>
    }
  }
}

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string

// AI radio-host lines that rotate beneath the wordmark
const AI_LINES = [
  'People nearby are posting street food finds — share your take!',
  'Trending: skyline shots by the harbourfront',
  '3 new pops in Kensington Market right now',
  'Poplur Radio: lo-fi beats live from Queen West',
  'Fit checks are taking over Trinity Bellwoods today',
  'Night market energy building in Chinatown',
]

// Clay weather icons keyed by open-meteo weather codes
function weatherIcon(code: number): string {
  if (code <= 1) return `<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="10" fill="#ffd94d"/><g stroke="#ffd94d" stroke-width="3" stroke-linecap="round"><path d="M20 3v5M20 32v5M3 20h5M32 20h5M8 8l3.5 3.5M28.5 28.5L32 32M32 8l-3.5 3.5M11.5 28.5L8 32"/></g></svg>`
  if (code <= 3 || code === 45 || code === 48) return `<svg viewBox="0 0 40 40"><ellipse cx="16" cy="24" rx="11" ry="8" fill="#FFF2F8"/><ellipse cx="27" cy="21" rx="10" ry="8" fill="#f4e4ee"/></svg>`
  if (code >= 71 && code <= 86) return `<svg viewBox="0 0 40 40"><ellipse cx="20" cy="16" rx="12" ry="8" fill="#FFF2F8"/><g fill="#c8f0ff"><circle cx="13" cy="30" r="2.5"/><circle cx="21" cy="33" r="2.5"/><circle cx="28" cy="29" r="2.5"/></g></svg>`
  if (code >= 95) return `<svg viewBox="0 0 40 40"><ellipse cx="20" cy="14" rx="12" ry="8" fill="#d8ccd4"/><path d="M20 20 L15 30 L20 29 L17 38 L26 26 L21 27 L24 20 Z" fill="#ffd94d"/></svg>`
  return `<svg viewBox="0 0 40 40"><ellipse cx="20" cy="14" rx="12" ry="8" fill="#FFF2F8"/><g stroke="#4fc0ff" stroke-width="3" stroke-linecap="round"><path d="M13 26v6M20 28v6M27 26v6"/></g></svg>`
}

export default function App() {
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>('queen')
  // Theme switching lives in the app's Profile → Settings; the prototype
  // ships the default clay skin with the infrastructure in place.
  const [theme] = useState(MAP_THEMES[0])
  const [aiIndex, setAiIndex] = useState(0)
  const [weather, setWeather] = useState<{ temp: number; code: number } | null>(null)
  const [weatherOverride, setWeatherOverride] = useState<WeatherMode | null>(null)
  const [dayTime, setDayTime] = useState(true)

  // Rotating AI text under the title (stable node; fade retriggered manually)
  const tickerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const iv = window.setInterval(() => setAiIndex(i => (i + 1) % AI_LINES.length), 4200)
    return () => window.clearInterval(iv)
  }, [])
  useEffect(() => {
    const el = tickerRef.current
    if (!el) return
    el.style.animation = 'none'
    void el.offsetWidth
    el.style.animation = ''
  }, [aiIndex])

  // Real weather + day/night for the map area (same open-meteo endpoint the
  // iOS app uses)
  useEffect(() => {
    fetch('https://api.open-meteo.com/v1/forecast?latitude=43.65&longitude=-79.38&current=temperature_2m,weather_code,is_day&temperature_unit=fahrenheit&timezone=auto')
      .then(res => res.json())
      .then(json => {
        setWeather({ temp: Math.round(json.current.temperature_2m), code: json.current.weather_code })
        setDayTime(json.current.is_day === 1)
      })
      .catch(() => setWeather({ temp: 72, code: 1 }))
  }, [])

  // DEV: cycle weather / sky from the console to demo every overlay
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as {
      __setWeather?: (m: WeatherMode | null) => void
      __setSky?: (day: boolean) => void
    }
    w.__setWeather = m => setWeatherOverride(m)
    w.__setSky = day => setDayTime(day)
  }, [])

  // Native bridge: the iOS/Android shells drive the map through
  // window.__poplurNative and receive events via postMessage.
  useEffect(() => {
    const w = window as unknown as {
      __poplurNative?: Record<string, unknown>
    }
    w.__poplurNative = {
      setCenter: (lng: number, lat: number, zoom?: number) =>
        mapRef.current?.easeTo({ center: [lng, lat], zoom: zoom ?? mapRef.current.getZoom(), duration: 800 }),
      flyTo: (lng: number, lat: number, zoom: number) => {
        const map = mapRef.current
        if (!map) return
        ;(map as unknown as { __cinematic?: boolean }).__cinematic = true
        map.flyTo({ center: [lng, lat], zoom, pitch: 64, duration: 4600, curve: 1.7, essential: true })
      },
      setSky: (day: boolean) => setDayTime(day),
      setWeather: (m: WeatherMode | null) => setWeatherOverride(m),
    }
    return () => { delete w.__poplurNative }
  }, [])

  const handleSelectPoi = useCallback((id: string) => {
    setSelectedId(id)
    const poi = POIS.find(p => p.id === id)
    const map = mapRef.current
    if (!poi || !map) return
    ;(map as unknown as { __cinematic?: boolean }).__cinematic = true
    map.flyTo({
      center: poi.coords,
      zoom: 15.8,
      pitch: 64,
      bearing: map.getBearing() + 40,
      duration: 4600,
      curve: 1.7,
      essential: true,
    })
  }, [])

  if (!TOKEN) {
    return (
      <div className={styles.noToken}>
        <p>Add <code>VITE_MAPBOX_TOKEN=pk.eyJ1…</code> to <code>.env</code> and restart.</p>
      </div>
    )
  }

  const weatherMode: WeatherMode = weatherOverride ?? (weather ? modeForCode(weather.code) : 'clear')

  return (
    <div className={styles.shell}>
      {/* ── Full-screen clay map ── */}
      <ClayMap
        token={TOKEN}
        pois={POIS}
        selectedId={selectedId}
        onSelectPoi={handleSelectPoi}
        mapRef={mapRef}
        theme={theme}
        dayTime={dayTime}
      />

      {/* ── Weather overlay effects (rain / storm / snow / cloudy / fog) ── */}
      <WeatherFX mode={weatherMode} />

      {/* ── Top chrome: provided clay logo + wordmark, with the AI line ── */}
      <TopChrome />
      <div ref={tickerRef} className={styles.aiTicker}>{AI_LINES[aiIndex]}</div>

      {/* ── Weather badge — left side, opposite the zoom slider ── */}
      {weather && (
        <div className={styles.weatherBadge}>
          <span className={styles.weatherIcon} dangerouslySetInnerHTML={{ __html: weatherIcon(weather.code) }} />
          <span className={styles.weatherTemp}>{weather.temp}°</span>
        </div>
      )}

      {/* ── The home cube: the actual provided GLB, swipe to spin ── */}
      <model-viewer
        className={styles.cubeViewer}
        src="cube.glb"
        camera-controls
        disable-zoom
        disable-pan
        interaction-prompt="none"
        auto-rotate
        auto-rotate-delay={3000}
        rotation-per-second="24deg"
        camera-orbit="30deg 72deg 108%"
        shadow-intensity="0"
        style={{ background: 'transparent' }}
        aria-label="Home cube"
      />
    </div>
  )
}
