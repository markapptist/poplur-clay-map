import React, { useState, useEffect, useRef } from 'react'
import styles from './HomeTwin.module.css'
import CubeTab3D, { type CubeTab } from './CubeTab3D'
import ClayChannelArrows from './ClayChannelArrows'
import FeedTwin, { CHANNELS } from './FeedTwin'
import ProfileTwin from './ProfileTwin'
import Camera from './Camera'
import HoldMenuTwin from './HoldMenuTwin'
import LoadingGlobe from './LoadingGlobe'
import { playPop, preloadPop } from './pop'
import { isGateMuted, isUserMuted, onGateChange, setUserMuted } from './audioGate'
import { isNativeShell, postNativeEvent } from './nativeBridge'
import type { HarnessView } from './ViewHarness'

const KM_TO_MI = 0.621371

// Browser twin of the iOS Home screen (map tab state), rebuilt from
// HomeView.swift + RecordingCountdownView.swift + RadiusNumberDisplayFIXED.swift.
// Both bottom counters share the CounterSeparatorMetrics vertical grid so their
// fraction bars sit level, exactly like the .counterSeparator alignment guide.
//
// The cube is live 3D (CubeTab3D): drag to swipe between faces, tap to pop,
// press-and-hold to open the hold menu twin. Pills track the front face;
// clicking the already-front face's pill opens that tab's screen twin.

const PILL_ORDER: CubeTab[] = ['map', 'feed', 'post', 'profile']

// The approved Loading screen's rotating copy (gcl-prototype loadingPage()),
// cycled on the same 1.8s beat with the same 200ms cross-fade.
const LOADING_MESSAGES = [
  'Warming up the pinetrees',
  'Rolling out the clay roads',
  'Dusting off the globe',
  'Pinning the hotspots',
  'Measuring your radius',
  'Sprinkling pink stars',
  'Waking up the tugboat',
  'Polishing the big P',
  'Fluffing the clouds',
]

// The cube scales with the phone width so it and the two flanking counters
// always fit — full 176 on a roomy phone, shrinking on tighter ones.
function cubeSizeFor(): number {
  if (typeof window === 'undefined') return 176
  return Math.round(Math.min(176, Math.max(124, window.innerWidth * 0.37)))
}

// Sample data matching the rest of the harness: 128 posts, 41.8 km radius.
const POST_COUNT = 128
const RADIUS_METERS = 41_800
const EARTH_RADIUS_KM = 6_371

// Home and Map use the same bundle. Dropping the query string renders App's map
// route, avoids a second dev-server dependency, and mirrors the native custom-
// scheme bundle exactly.
// `front=0` tells the embedded map it is booting behind another tab, so it
// skips the 7s cinematic intro (which streams tiles and uploads textures the
// whole way) and just lands. Without it the map's intro runs behind Feed /
// Profile / Camera and drags those screens into single-digit fps.
const CLAY_MAP_SRC = (() => {
  const front = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('view') === 'map' ? '1' : '0'
  return typeof window !== 'undefined' && window.location.protocol.startsWith('http')
    ? `${window.location.origin}/?front=${front}`
    : `index.html?front=${front}`
})()

// Android app shell (PoplurNative bridge). Its budget GPUs can't afford Mapbox
// running behind every tab, so the map iframe mounts on-demand there (see the
// map layer below). iOS and the browser keep the always-warm map.
const ANDROID_SHELL =
  typeof window !== 'undefined' &&
  Boolean((window as unknown as { PoplurNative?: unknown }).PoplurNative)

// How long the map iframe survives after its tab stops being front.
//
// A `display:none` iframe is NOT `document.hidden` in Chrome or WKWebView: the
// map keeps its GL context, its tile workers and a full-resolution (1179x2556)
// canvas alive behind whatever tab is actually in front. Measured on the built
// bundle, that held Feed / Home at ~3fps while the map itself was drawing
// roughly one call per second — the cost is the iframe existing, not its work.
// Hiding it, shrinking its canvas to 2x2 and pausing its render loop all
// measured no better; only unmounting recovered the frame budget (~3 -> 30fps).
//
// So every shell now takes the Android trade: the map is mounted ONLY while the
// Map tab is front. Leaving it unmounts the iframe immediately, which recovers
// the full frame budget on Profile / Feed / Camera (profile measured 5.5 ->
// 59.9fps median once the map is gone). Coming back to Map remounts a fresh
// iframe, which shows the loading globe while it boots — the same overlay the
// map route already uses. `?map-grace=<seconds>` opts back into a warm bounce
// for testing (the iframe lingers that long so a quick return to Map is free);
// the default 0 keeps the map off every non-map tab.
const MAP_GRACE_MS = (() => {
  const fallback = 0
  if (typeof window === 'undefined') return fallback
  const raw = new URLSearchParams(window.location.search).get('map-grace')
  if (raw === null) return fallback
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : fallback
})()

export default function HomeTwin({ onOpen, onTabChange, initialTab = 'map', initialHoldOpen = false, initialCameraPage = 'live' }: { onOpen: (view: HarnessView) => void; onTabChange?: (tab: CubeTab) => void; initialTab?: CubeTab; initialHoldOpen?: boolean; initialCameraPage?: 'live' | 'roll' }) {
  // Tabs render inline: the pills switch map / feed / camera(post) / profile
  // content within this one home view instead of routing to separate screens.
  const [activeTab, setActiveTab] = useState<CubeTab>(initialTab)
  useEffect(() => { preloadPop() }, [])
  useEffect(() => {
    onTabChange?.(activeTab)
    // Native shell: tell the app which tab is front so it can mount real
    // device power behind the web chrome (e.g. the native ML camera on 'post').
    if (isNativeShell()) postNativeEvent({ type: 'tabChanged', tab: activeTab })
  }, [activeTab, onTabChange])
  // The cube long-press hold menu floats as a translucent overlay over the
  // current tab, and its items match that tab.
  const [holdOpen, setHoldOpen] = useState(initialHoldOpen)
  const [popping, setPopping] = useState(false)
  // Radius units cycle km ⇄ mi continuously, like the app's radius display.
  const [unitMi, setUnitMi] = useState(false)
  // Right slot cross-fades RADIUS ⇄ TRENDING (the feed's animated label).
  const [showTrending, setShowTrending] = useState(true)
  // Left slot: channel up/down changer — drives the feed's channel directly.
  const [chanIndex, setChanIndex] = useState(0)
  // Cube size follows the viewport so the bottom cluster never overlaps.
  const [cubeSize, setCubeSize] = useState(cubeSizeFor)
  const mapFrameRef = useRef<HTMLIFrameElement>(null)
  // The map itself owns readiness. An iframe load is too early: Mapbox still
  // has to apply its style and complete the globe-to-city intro.
  const [mapReady, setMapReady] = useState(false)
  // The map iframe mounts only while the Map tab is front (the Android trade):
  // it starts mounted only when Home opens directly on the map, and otherwise
  // stays absent so Profile / Feed / Camera keep their full frame budget. It is
  // torn down once the user leaves the map (after MAP_GRACE_MS, default 0).
  const [mapMounted, setMapMounted] = useState(initialTab === 'map')
  const [loadingMessage, setLoadingMessage] = useState(0)
  const [messageShown, setMessageShown] = useState(true)
  const [loadingMuted, setLoadingMuted] = useState(isUserMuted)
  // The tab pills are a testing aid. Keep them out of the app/RN surface unless
  // a prototype session explicitly asks for them with ?tabs=1.
  const showTestTabs = typeof window !== 'undefined'
    && !isNativeShell()
    && new URLSearchParams(window.location.search).get('tabs') === '1'
  const forceMapLoading = import.meta.env.DEV
    && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('map-loading') === '1'
  useEffect(() => {
    // Radius is the headline metric: no auto unit flip (it used to swap km/mi
    // every 2.5s, so the number never held still) and no cross-fade — tapping
    // the value toggles units instead. TRENDING keeps its own small line.
    const fade = 0
    const onResize = () => setCubeSize(cubeSizeFor())
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [])

  useEffect(() => {
    // Ask while Home opens on Feed so the already-mounted map can finish its
    // location-aware intro behind the screen rather than prompting on Map.
    if (isNativeShell()) {
      postNativeEvent({ type: 'requestLocation' })
    } else if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        () => {},
        () => {},
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 },
      )
    }

    const onMapMessage = (event: MessageEvent) => {
      if (event.source !== mapFrameRef.current?.contentWindow) return
      if (!event.data || typeof event.data !== 'object') return
      if (event.data.type === 'poplur-map-loading') setMapReady(false)
      if (event.data.type === 'poplur-map-ready') {
        setMapReady(true)
        if (window.parent !== window) window.parent.postMessage({ type: 'poplur-home-ready' }, '*')
        postNativeEvent({ type: 'homeReady' })
      }
    }
    window.addEventListener('message', onMapMessage)
    return () => window.removeEventListener('message', onMapMessage)
  }, [])

  // The map iframe stays mounted on every tab, so its audio (radio, ambience,
  // pops) must be gated here: audible only while the MAP tab is front-most AND
  // this harness itself is audible (not board-muted, not backgrounded). Resent
  // on mapReady because the iframe's listener isn't up for the earliest sends.
  useEffect(() => {
    const send = () => {
      const audible = activeTab === 'map' && !isGateMuted()
      mapFrameRef.current?.contentWindow?.postMessage({ gcAudio: audible ? 'on' : 'off' }, '*')
    }
    send()
    return onGateChange(send)
  }, [activeTab, mapReady])

  // Rotate the loading copy only while the overlay is up.
  // Map lifetime. Coming back to the map remounts it immediately; leaving it
  // starts the grace timer, and only when that expires does the iframe go away.
  // Clearing mapReady on teardown puts the map's own loading screen back, so a
  // remounted map shows the loading globe instead of a blank layer.
  useEffect(() => {
    if (activeTab === 'map') { setMapMounted(true); return }
    const drop = () => { setMapMounted(false); setMapReady(false) }
    if (ANDROID_SHELL || MAP_GRACE_MS === 0) { drop(); return }
    const timer = window.setTimeout(drop, MAP_GRACE_MS)
    return () => window.clearTimeout(timer)
  }, [activeTab])

  const loadingVisible = activeTab === 'map' && (!mapReady || forceMapLoading)
  useEffect(() => {
    if (!loadingVisible) return
    const iv = window.setInterval(() => {
      setMessageShown(false)
      window.setTimeout(() => {
        setLoadingMessage(i => (i + 1) % LOADING_MESSAGES.length)
        setMessageShown(true)
      }, 200)
    }, 1800)
    return () => window.clearInterval(iv)
  }, [loadingVisible])

  // Camera's vertical pager: `step` counts arrow presses (up +1 / down -1);
  // parity picks the page, so both directions cycle live ⇄ roll.
  const [cameraStep, setCameraStep] = useState(initialCameraPage === 'roll' ? 1 : 0)
  useEffect(() => { if (activeTab !== 'post') setCameraStep(0) }, [activeTab])

  // Profile tab: the clay arrows scroll the grid / browse the open post —
  // ProfileTwin registers its handler here.
  const profileArrowsRef = useRef<((dir: 1 | -1) => void) | null>(null)

  // (The pop lives in ClayChannelArrows itself now — every press pops.)
  const changeChannel = (dir: 1 | -1) => {
    // On the camera tab the clay arrows page the camera itself: up slides
    // up, down slides down, both directions wrap live ⇄ roll.
    if (activeTab === 'post') {
      setCameraStep(s => s + (dir === -1 ? 1 : -1))
      return
    }
    if (activeTab === 'profile') {
      profileArrowsRef.current?.(dir)
      return
    }
    if (activeTab === 'map') {
      // On the map the arrows cycle the user's pops: the map flies pop-to-pop
      // with the tour camera instead of changing feed channels.
      mapFrameRef.current?.contentWindow?.postMessage({ type: 'poplur-map-action', action: 'cyclePop', dir }, '*')
      return
    }
    setChanIndex(i => (i + dir + CHANNELS.length) % CHANNELS.length)
  }

  const popCube = () => {
    playPop()
    setPopping(true)
    // The cube IS the camera shutter on the post tab — fire the real native
    // capture (previous versions' cube-tap capture) through the bridge.
    if (activeTab === 'post' && isNativeShell()) postNativeEvent({ type: 'cameraShutter' })
  }

  return (
    <section
      className={styles.home}
      style={{ '--cube-size': `${cubeSize}px` } as React.CSSProperties}
    >
      {/* The map iframe mounts only while the Map tab is front. CSS cannot make
          an idle map cheap (a hidden iframe still holds its GL context, tile
          workers and full-res canvas), so leaving the map unmounts it entirely
          and returning remounts a fresh iframe (see MAP_GRACE_MS). This keeps
          the map from starving Profile / Feed / Camera of frames. */}
      {mapMounted && (
        <iframe
          ref={mapFrameRef}
          className={activeTab === 'map' ? styles.mapLayer : `${styles.mapLayer} ${styles.mapLayerIdle}`}
          src={CLAY_MAP_SRC}
          title="Poplur clay map"
          allow="autoplay; geolocation"
        />
      )}

      <div className={styles.contentLayer}>
        {activeTab === 'feed' && <FeedTwin index={chanIndex} onIndexChange={setChanIndex} />}
        {activeTab === 'post' && <Camera step={cameraStep} onCloseRoll={() => setCameraStep(s => s - 1)} />}
        {activeTab === 'profile' && <ProfileTwin bindArrows={fn => { profileArrowsRef.current = fn }} />}
      </div>

      {loadingVisible && (
        <div className={styles.mapLoading} role="status" aria-label="Loading the map">
          <LoadingGlobe />
          {/* Mute control, matching the approved Loading screen's top-left mark. */}
          <button
            type="button"
            className={styles.mapLoadingMute}
            aria-label={loadingMuted ? 'Unmute sound' : 'Mute sound'}
            aria-pressed={loadingMuted}
            onClick={() => { const next = !loadingMuted; setUserMuted(next); setLoadingMuted(next) }}
          >
            <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
              <path d="M6 12h4l6-5v18l-6-5H6z" fill="#fff2f8" stroke="rgba(10,30,110,.55)" strokeWidth="1.3" strokeLinejoin="round" />
              {!loadingMuted && <g>
                <path d="M21 11.5a7 7 0 0 1 0 9" fill="none" stroke="#fff2f8" strokeWidth="2.4" strokeLinecap="round" />
                <path d="M25 8.5a11.5 11.5 0 0 1 0 15" fill="none" stroke="#d6e7ff" strokeWidth="2.4" strokeLinecap="round" />
              </g>}
              {loadingMuted && <line x1="20" y1="26" x2="30" y2="6" stroke="#fff2f8" strokeWidth="3" strokeLinecap="round" />}
            </svg>
          </button>
          <div className={styles.mapLoadingLoader}>
            <p
              className={styles.mapLoadingText}
              style={{ opacity: messageShown ? 1 : 0 }}
              aria-live="polite"
            >
              {LOADING_MESSAGES[loadingMessage]}
            </p>
            <div className={styles.mapLoadingTrack} role="progressbar" aria-label="Loading map">
              <span className={styles.mapLoadingFill} />
            </div>
          </div>
        </div>
      )}

      {/* Bottom HUD — channel changer + RADIUS ⇄ TRENDING label. Persistent
          across every tab. The row hugs the cube's box (same bottom, same
          height) and lays out as [arrows | cube-width gap | label] on one
          center line: the cube sits exactly centered in the middle column and
          the arrows/label sit an EQUAL gap from either side of it. */}
      <div className={styles.bottomRow}>
        {/* LEFT: clay channel up / down arrows (light up on press, feed-style) */}
        <div className={styles.chanSlot}>
          <ClayChannelArrows
            size={cubeSize}
            number={CHANNELS[chanIndex].number}
            onUp={() => changeChannel(-1)}
            onDown={() => changeChannel(1)}
          />
        </div>

        <div className={styles.cubeSpacer} aria-hidden="true" />

        {/* RIGHT: the feed's animated RADIUS ◆ ⇄ TRENDING ↑ label */}
        <div className={styles.statStack}>
          {/* RADIUS is permanent — the app's headline number. It no longer shares
              this slot with TRENDING (which hid it half the time) and no longer
              auto-flips units. Tap the value to switch km/mi. */}
          <div
            className={styles.statCard}
            onClick={() => { playPop(); setUnitMi(v => !v) }}
            role="button"
            aria-label={`Radius ${(unitMi ? (RADIUS_METERS / 1000) * KM_TO_MI : RADIUS_METERS / 1000).toFixed(1)} ${unitMi ? 'miles' : 'kilometres'} — tap to change units`}
          >
            <span className={styles.statLabel}>RADIUS ◆</span>
            <span className={styles.statValue}>
              {(unitMi ? (RADIUS_METERS / 1000) * KM_TO_MI : RADIUS_METERS / 1000).toFixed(1)}
              <span className={styles.statUnit}>{unitMi ? 'mi' : 'km'}</span>
            </span>
            <span className={styles.statSub}>
              of {(unitMi ? Math.round(EARTH_RADIUS_KM * KM_TO_MI) : EARTH_RADIUS_KM).toLocaleString()} {unitMi ? 'mi' : 'km'}
            </span>
            <span className={styles.statTrend}>TRENDING ↑ {POST_COUNT} nearby</span>
          </div>
        </div>
      </div>

      {/* The cube is the persistent navigator — visible on every tab, floating
          over whatever content is active. Its face tracks the current tab. */}
      <div className={styles.groundGlow} />
      <div className={styles.cubeWrap} style={{ width: cubeSize, height: cubeSize }}>
        <div
          className={popping ? `${styles.cubePop} ${styles.cubeFloat}` : styles.cubeFloat}
          onAnimationEnd={e => { if (e.animationName.includes('Pop')) setPopping(false) }}
        >
          <CubeTab3D
            size={cubeSize}
            targetTab={activeTab}
            onFaceChange={tab => { playPop(); setActiveTab(tab) }}
            onTap={popCube}
            onHold={() => {
              playPop()
              setHoldOpen(true)
            }}
          />
        </div>
      </div>

      {/* Tab pills — a prototype-only testing aid (see showTestTabs). The real
          app navigates with the cube, so these never render outside the prototype. */}
      {showTestTabs && <div className={styles.tabPills}>
        {PILL_ORDER.map(tab => (
          <button
            key={tab}
            type="button"
            className={tab === activeTab ? styles.pillActive : styles.pill}
            onClick={() => { playPop(); setActiveTab(tab) }}
          >
            {tab}
          </button>
        ))}
      </div>}

      {/* Cube long-press hold menu — translucent overlay whose item set matches
          the tab it was opened from. Closes back to that tab. */}
      {holdOpen && <HoldMenuTwin tab={activeTab} onClose={() => setHoldOpen(false)} />}
    </section>
  )
}

// (The old TrendingCounter / RadiusCounter pair was replaced by the feed's
//  animated RADIUS ◆ ⇄ TRENDING ↑ stat label, rendered inline above.)
