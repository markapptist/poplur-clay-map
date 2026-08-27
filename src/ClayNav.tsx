import { onFrame } from './frameGovernor'
import { cancelManagedRenderingWake, wakeManagedRendering } from './nativeBridge'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import type mapboxgl from 'mapbox-gl'
import { modelSprite } from './modelSprite'
import type { MapTheme } from './data'
import styles from './ClayNav.module.css'
import surfaceStyles from './TransientPopupSurface.module.css'

// Clay GPS navigation. Enter a destination → real Mapbox Directions route,
// drawn as a clay artery. Hit Go and the camera drops into the clay "street
// view" (the same clay world at street level, pitch 82) and drives the route:
// the Poplur car leads a car-length ahead, the chase-cam follows the heading,
// and the Poplur AI speaks each turn. No Street-View photos are involved — the
// clay city IS the street view, so it's clay for free.

interface ClayNavProps {
  mapRef: React.MutableRefObject<mapboxgl.Map | null>
  token: string
  theme: MapTheme
  /** Stable launch/current-location origin; never the roaming tour camera. */
  routeOrigin: LngLat
  /** Pauses any autonomous camera motion before routing or driving. */
  onRouteIntent?: () => void
  streetView: boolean
  /** Increment to open the Directions search (hold-menu entry replaces the FAB). */
  openSignal?: number
  setStreetView: (on: boolean) => void
  /** Show a line in the AI ticker (mirrors the Poplur AI voice). */
  say: (line: string | null) => void
}

type Mode = 'idle' | 'searching' | 'preview' | 'navigating' | 'arrived'
type LngLat = [number, number]
interface Step { at: number; text: string; type: string; name: string }
interface Route { coords: LngLat[]; cum: number[]; distance: number; duration: number; steps: Step[] }
interface Destination { center: LngLat; name: string }

const SRC = 'clay-nav-route'
const ANNOUNCE_M = 140   // speak the upcoming turn this far out
const DRIVE_MPS = 20     // demo ground speed (~72 km/h) along the route
const MANAGED_CAMERA_SETTLE_MS = 400
const DRIVE_LEASE_CHUNK_MS = 44_000

// ---- geo helpers ----
function haversine(a: LngLat, b: LngLat): number {
  const R = 6371000
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLng = ((b[0] - a[0]) * Math.PI) / 180
  const la1 = (a[1] * Math.PI) / 180
  const la2 = (b[1] * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
function bearing(a: LngLat, b: LngLat): number {
  const la1 = (a[1] * Math.PI) / 180, la2 = (b[1] * Math.PI) / 180
  const dLng = ((b[0] - a[0]) * Math.PI) / 180
  const y = Math.sin(dLng) * Math.cos(la2)
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng)
  return (Math.atan2(y, x) * 180) / Math.PI
}
// position + heading at `dist` metres along the route
function alongRoute(r: Route, dist: number): { pos: LngLat; brg: number } {
  const d = Math.max(0, Math.min(r.distance, dist))
  let i = 1
  while (i < r.cum.length && r.cum[i] < d) i++
  const i0 = i - 1, i1 = Math.min(i, r.coords.length - 1)
  const seg = r.cum[i1] - r.cum[i0] || 1
  const f = (d - r.cum[i0]) / seg
  const a = r.coords[i0], b = r.coords[i1]
  return { pos: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], brg: bearing(a, b) }
}
function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`
}
function fmtEta(sec: number): string {
  const m = Math.round(sec / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`
}

async function findDestination(query: string, origin: LngLat, token: string): Promise<Destination | null> {
  const sessionToken = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`

  try {
    const suggestResponse = await fetch(
      'https://api.mapbox.com/search/searchbox/v1/suggest' +
      `?q=${encodeURIComponent(query)}&proximity=${origin[0]},${origin[1]}` +
      `&language=en&limit=8&session_token=${sessionToken}&access_token=${token}`,
    )
    const suggestJson = await suggestResponse.json() as {
      suggestions?: Array<{ mapbox_id?: string; name?: string; full_address?: string }>
    }
    if (!suggestResponse.ok) throw new Error('Place search failed')
    const suggestion = suggestJson.suggestions?.find(item => item.mapbox_id)
    if (!suggestion?.mapbox_id) return null

    const retrieveResponse = await fetch(
      `https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(suggestion.mapbox_id)}` +
      `?session_token=${sessionToken}&access_token=${token}`,
    )
    const retrieveJson = await retrieveResponse.json() as {
      features?: Array<{
        geometry?: { coordinates?: LngLat }
        properties?: { name?: string; full_address?: string }
      }>
    }
    if (!retrieveResponse.ok) throw new Error('Place details failed')
    const feature = retrieveJson.features?.[0]
    const center = feature?.geometry?.coordinates
    if (!center || !Number.isFinite(center[0]) || !Number.isFinite(center[1])) return null
    const placeName = feature.properties?.name || suggestion.name || query
    const address = feature.properties?.full_address || suggestion.full_address
    return { center, name: address ? `${placeName}, ${address}` : placeName }
  } catch {
    // Older native bundles may not have Search Box access, so retain a
    // geocoding fallback while keeping the proximity hint.
    const geoResponse = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
      `?proximity=${origin[0]},${origin[1]}&limit=1&access_token=${token}`,
    )
    const geo = await geoResponse.json() as {
      features?: Array<{ center: LngLat; text?: string; place_name?: string }>
    }
    if (!geoResponse.ok) throw new Error('Address search is unavailable right now.')
    const feature = geo.features?.[0]
    return feature
      ? { center: feature.center, name: feature.place_name || feature.text || query }
      : null
  }
}

function directionsError(message?: string, code?: string): string {
  if (/maximum distance|too far/i.test(message ?? '')) {
    return 'That result is too far away to route. Try adding a city, postal code, or street address.'
  }
  if (code === 'NoRoute') return 'No drivable route was found from your location to that address.'
  return 'Directions are unavailable right now. Please try again.'
}

const MANEUVER_ICON: Record<string, string> = {
  left: 'M12 20V8m0 0-5 5m5-5 5 5', right: 'M12 20V8m0 0-5 5m5-5 5 5',
  straight: 'M12 20V5m0 0-4 4m4-4 4 4', arrive: 'M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z',
}

export default function ClayNav({ mapRef, token, theme, routeOrigin, onRouteIntent, streetView, setStreetView, say, openSignal = 0 }: ClayNavProps) {
  const [mode, setMode] = useState<Mode>('idle')
  const [query, setQuery] = useState('')
  const [destName, setDestName] = useState('')
  const [route, setRoute] = useState<Route | null>(null)
  const [banner, setBanner] = useState<{ text: string; dist: number; type: string } | null>(null)
  const [remain, setRemain] = useState<{ dist: number; eta: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isRouting, setIsRouting] = useState(false)

  const carRef = useRef<mapboxgl.Marker | null>(null)
  const destMarkRef = useRef<mapboxgl.Marker | null>(null)
  // Unsubscribe from the shared frame clock (frameGovernor) while driving.
  const stopTickRef = useRef<(() => void) | null>(null)
  const driveLeaseTimerRef = useRef(0)
  const carSpriteRef = useRef<string | null>(null)
  const spokenRef = useRef<Set<number>>(new Set())

  // ---- speech (the Poplur AI voice) ----
  const speak = useCallback((text: string) => {
    say(text)
    try {
      const synth = window.speechSynthesis
      if (!synth) return
      synth.cancel()
      const u = new SpeechSynthesisUtterance(text)
      const gb = synth.getVoices().find(v => /en-GB/i.test(v.lang)) || synth.getVoices().find(v => /en/i.test(v.lang))
      if (gb) u.voice = gb
      u.rate = 1.02; u.pitch = 1.05
      synth.speak(u)
    } catch { /* speech unsupported */ }
  }, [say])

  // preload the Poplur car sprite (same GLB the ambient cars use)
  useEffect(() => {
    modelSprite('models/car.glb', { pitch: 62, yaw: 90, size: 256 })
      .then(s => { carSpriteRef.current = s })
      .catch(() => {})
  }, [])

  const removeRouteLayers = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    for (const id of [`${SRC}-line`, `${SRC}-casing`]) if (map.getLayer(id)) map.removeLayer(id)
    if (map.getSource(SRC)) map.removeSource(SRC)
  }, [mapRef])

  const teardown = useCallback(() => {
    const activeDrive = stopTickRef.current
    activeDrive?.()
    stopTickRef.current = null
    window.clearTimeout(driveLeaseTimerRef.current)
    driveLeaseTimerRef.current = 0
    if (activeDrive) cancelManagedRenderingWake()
    window.speechSynthesis?.cancel()
    carRef.current?.remove(); carRef.current = null
    destMarkRef.current?.remove(); destMarkRef.current = null
    removeRouteLayers()
    spokenRef.current.clear()
    say(null)
  }, [removeRouteLayers, say])

  useEffect(() => () => teardown(), [teardown])

  // ---- fetch a route to the typed destination ----
  const search = useCallback(async () => {
    const map = mapRef.current
    if (!query.trim() || isRouting) return
    if (!map) {
      setError('The map is still loading. Try again in a moment.')
      return
    }
    onRouteIntent?.()
    setError(null)
    setIsRouting(true)
    const origin: LngLat = routeOrigin
    try {
      const destination = await findDestination(query.trim(), origin, token)
      if (!destination) { setError('No place found. Try another name or a full address.'); return }
      const dest = destination.center
      const directionsResponse = await fetch(
        `https://api.mapbox.com/directions/v5/mapbox/driving/${origin[0]},${origin[1]};${dest[0]},${dest[1]}` +
        `?geometries=geojson&overview=full&steps=true&access_token=${token}`,
      )
      const dir = await directionsResponse.json() as {
        code?: string
        message?: string
        routes?: Array<{
          geometry: { coordinates: LngLat[] }
          distance: number
          duration: number
          legs?: Array<{ steps?: Array<{
            maneuver: { instruction: string; type: string; modifier?: string }
            name: string
            distance: number
          }> }>
        }>
      }
      if (!directionsResponse.ok) throw new Error(directionsError(dir.message, dir.code))
      const leg = dir.routes?.[0]
      if (!leg) {
        setError(directionsError(dir.message, dir.code))
        return
      }
      const coords = leg.geometry.coordinates as LngLat[]
      if (coords.length < 2) { setError('That route did not include a usable path.'); return }
      const cum = [0]
      for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]))
      // maneuver distance = start of each step; instruction text from the API
      let acc = 0
      const steps: Step[] = (leg.legs?.[0]?.steps ?? []).map((s: {
        maneuver: { instruction: string; type: string; modifier?: string }; name: string; distance: number
      }) => {
        const at = acc; acc += s.distance
        return { at, text: s.maneuver.instruction, type: s.maneuver.modifier || s.maneuver.type, name: s.name }
      })
      const r: Route = { coords, cum, distance: leg.distance, duration: leg.duration, steps }
      setRoute(r)
      setDestName(destination.name)

      // draw the clay artery + endpoints
      removeRouteLayers()
      map.addSource(SRC, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } })
      map.addLayer({
        id: `${SRC}-casing`, type: 'line', source: SRC,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': theme.roadRim, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 8, 19, 26], 'line-opacity': 0.9 },
      })
      map.addLayer({
        id: `${SRC}-line`, type: 'line', source: SRC,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': theme.accentHot, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 4, 19, 15] },
      })

      const el = document.createElement('div')
      el.className = styles.destPin
      el.innerHTML = `<img src="clay_pin.png" alt="">`
      destMarkRef.current?.remove()
      const mapboxgl = (await import('mapbox-gl')).default
      destMarkRef.current = new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat(dest).addTo(map)

      // frame the whole route for the preview
      const b = coords.reduce((acc2, p) => acc2.extend(p), new mapboxgl.LngLatBounds(coords[0], coords[0]))
      wakeManagedRendering(1400 + MANAGED_CAMERA_SETTLE_MS)
      map.fitBounds(b, { padding: 90, pitch: 40, duration: 1400 })
      setMode('preview')
    } catch (cause) {
      setError(cause instanceof Error && cause.message
        ? cause.message
        : 'Directions are unavailable right now. Please try again.')
    } finally {
      setIsRouting(false)
    }
  }, [mapRef, query, isRouting, onRouteIntent, routeOrigin, token, theme, removeRouteLayers])

  // ---- drive the route ----
  const start = useCallback(() => {
    const map = mapRef.current
    if (!map || !route) return
    onRouteIntent?.()
    setStreetView(true)                 // clay street-view context (label culling)
    setMode('navigating')
    spokenRef.current.clear()
    speak(`Starting navigation to ${destName}. ${route.steps[1]?.text ?? ''}`)

    import('mapbox-gl').then(({ default: mapboxgl }) => {
      const carEl = document.createElement('div')
      carEl.className = styles.navCar
      if (carSpriteRef.current) carEl.innerHTML = `<img src="${carSpriteRef.current}" alt="">`
      carRef.current?.remove()
      carRef.current = new mapboxgl.Marker({ element: carEl, anchor: 'center', rotationAlignment: 'map' }).setLngLat(route.coords[0]).addTo(map)

      let progress = 0
      let smBrg = alongRoute(route, 0).brg
      // Interactive rate on the shared clock: driving is an attended task, but
      // jumpTo repaints the whole map every call — 120Hz on ProMotion was double
      // the repaints of anything the eye needs, during the exact activity
      // (screen on, GPS on) where the phone already runs hottest.
      const tick = (dtMs: number) => {
        const dt = Math.min(0.05, dtMs / 1000)
        progress = Math.min(route.distance, progress + DRIVE_MPS * dt)

        const me = alongRoute(route, progress)
        const lead = alongRoute(route, progress + 16) // Poplur car a length ahead
        // smooth the heading so turns aren't jarring
        let d = ((lead.brg - smBrg + 540) % 360) - 180
        smBrg += d * Math.min(1, dt * 4)

        map.jumpTo({ center: me.pos, bearing: smBrg, pitch: 82, zoom: 18.4 })
        carRef.current?.setLngLat(lead.pos).setRotation(lead.brg)

        // next maneuver banner + spoken turn
        const next = route.steps.find(s => s.at > progress + 4)
        if (next) {
          const away = next.at - progress
          setBanner({ text: next.text, dist: away, type: next.type })
          if (away < ANNOUNCE_M && !spokenRef.current.has(next.at)) {
            spokenRef.current.add(next.at)
            speak(`In ${fmtDist(away)}, ${next.text}`)
          }
        } else {
          setBanner(null)
        }
        const rem = route.distance - progress
        setRemain({ dist: rem, eta: route.duration * (rem / route.distance) })

        if (progress >= route.distance - 1) {
          setMode('arrived'); setBanner(null)
          speak(`You have arrived at ${destName}.`)
          stopTickRef.current?.()
          stopTickRef.current = null
          window.clearTimeout(driveLeaseTimerRef.current)
          driveLeaseTimerRef.current = 0
          cancelManagedRenderingWake()
        }
      }
      stopTickRef.current?.()
      window.clearTimeout(driveLeaseTimerRef.current)
      stopTickRef.current = onFrame(tick, 'interactive')
      // Route driving is finite and attended, but a real route can exceed one
      // 45-second lease. Renew in bounded chunks only while this exact drive
      // still owns its frame subscription; arrival, Stop and unmount all clear
      // the renewal. The planned route duration remains the absolute deadline.
      const driveDeadline = performance.now()
        + (route.distance / DRIVE_MPS) * 1000
        + MANAGED_CAMERA_SETTLE_MS
      const renewDriveLease = () => {
        if (!stopTickRef.current) return
        const remaining = driveDeadline - performance.now()
        if (remaining <= 0) return
        wakeManagedRendering(Math.min(45_000, remaining))
        if (remaining > DRIVE_LEASE_CHUNK_MS) {
          driveLeaseTimerRef.current = window.setTimeout(renewDriveLease, DRIVE_LEASE_CHUNK_MS)
        }
      }
      renewDriveLease()
    })
  }, [mapRef, route, destName, onRouteIntent, setStreetView, speak])

  const end = useCallback(() => {
    teardown()
    setStreetView(false)
    setMode('idle'); setRoute(null); setBanner(null); setRemain(null); setQuery('')
  }, [teardown, setStreetView])

  // The Directions entry moved into the hold menu: it bumps openSignal, which
  // opens the search card exactly like the old on-map FAB tap did.
  useEffect(() => {
    if (openSignal > 0) { onRouteIntent?.(); setError(null); setMode('searching') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal])

  // ---- UI ----
  const maneuverPath = (t: string) => MANEUVER_ICON[t] || (/(left)/i.test(t) ? MANEUVER_ICON.left : /(right)/i.test(t) ? MANEUVER_ICON.right : MANEUVER_ICON.straight)

  return (
    <div className={styles.wrap}>
      {/* Directions FAB removed — the hold menu's DIRECTIONS entry opens the
          search via openSignal (declutter the map). */}

      {mode === 'searching' && (
        <form className={`${styles.searchCard} ${surfaceStyles.surface}`} aria-busy={isRouting} onSubmit={e => { e.preventDefault(); void search() }}>
          <div className={styles.searchHeader}>
            <span className={styles.searchBadge} aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M12 21s6-5.38 6-11A6 6 0 0 0 6 10c0 5.62 6 11 6 11Z" />
                <circle cx="12" cy="10" r="2.2" />
              </svg>
            </span>
            <span className={styles.searchHeading}>
              <small>POPLUR DIRECTIONS</small>
              <strong>Find your way</strong>
            </span>
            <span className={styles.searchReady}><i />Ready</span>
          </div>
          <label className={styles.destinationField}>
            <span>DESTINATION</span>
            <input
              autoFocus required value={query} disabled={isRouting}
              onChange={e => { setQuery(e.target.value); setError(null) }}
              onKeyDown={e => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                void search()
              }}
              placeholder="Search a place" className={styles.searchInput}
            />
          </label>
          <div className={styles.routeOrigin} aria-label="Route starts at your location">
            <span className={styles.originDot} aria-hidden="true" />
            <span>FROM</span>
            <strong>Your location</strong>
          </div>
          <div className={styles.searchRow}>
            <button type="button" className={`${styles.ghostBtn} ${surfaceStyles.secondary}`} disabled={isRouting} onClick={() => { setMode('idle'); setError(null) }}>Cancel</button>
            <button type="submit" className={`${styles.goBtn} ${surfaceStyles.primary}`} disabled={isRouting}>{isRouting ? 'Routing…' : 'Search route'}</button>
          </div>
          {error && <div className={styles.err} role="alert" aria-live="polite">{error}</div>}
        </form>
      )}

      {mode === 'preview' && route && (
        <div className={`${styles.previewCard} ${surfaceStyles.surface}`}>
          <div className={styles.previewHead}>
            <img src="clay_pin.png" alt="" />
            <div>
              <strong>{destName}</strong>
              <span>{fmtDist(route.distance)} · {fmtEta(route.duration)}</span>
            </div>
          </div>
          <div className={styles.searchRow}>
            <button type="button" className={`${styles.ghostBtn} ${surfaceStyles.secondary}`} onClick={end}>Cancel</button>
            <button type="button" className={`${styles.goBtn} ${surfaceStyles.primary}`} onClick={start}>Go ▸</button>
          </div>
        </div>
      )}

      {mode === 'navigating' && banner && (
        <div className={`${styles.turnBanner} ${surfaceStyles.surface}`}>
          <svg viewBox="0 0 24 24" width="34" height="34"><path d={maneuverPath(banner.type)} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <div>
            <strong>{fmtDist(banner.dist)}</strong>
            <span>{banner.text}</span>
          </div>
        </div>
      )}

      {(mode === 'navigating' || mode === 'arrived') && (
        <div className={`${styles.navBar} ${surfaceStyles.surface}`}>
          {mode === 'arrived'
            ? <div className={styles.arrived}>Arrived at {destName}</div>
            : remain && <div className={styles.navStats}><strong>{fmtEta(remain.eta)}</strong><span>{fmtDist(remain.dist)} left</span></div>}
          <button type="button" className={styles.endBtn} onClick={end}>{mode === 'arrived' ? 'Done' : 'End'}</button>
        </div>
      )}
    </div>
  )
}
