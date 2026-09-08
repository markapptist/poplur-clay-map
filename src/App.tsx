import React from 'react'
import { startEngagementChips } from './engagement'
import PopupHost from './popups'
import ViewHarness, { harnessViewFromLocation, type HarnessView } from './ViewHarness'
import VolumeBars from './VolumeBars'
import { useTestActivityReporter } from './testActivity'
import { useAppPresenceReporter } from './appPresence'

// Mapbox, its live-data graph, and every map controller stay out of the public
// Home/Hold route. The internal map iframe pays that cost only when HomeTwin
// actually mounts it, so opening Feed/Profile/Camera no longer wakes a hidden
// map application merely to return a different screen at the bottom of it.
const MapApp = React.lazy(() => import('./MapApp'))

function MapFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'grid',
        placeItems: 'center',
        width: '100vw',
        height: '100vh',
        background: '#100b1c',
        color: '#fff',
      }}
    >
      Loading map…
    </div>
  )
}

function HarnessApp({ initialView }: { initialView: HarnessView }) {
  // The shell is the one notice host for engagement forwarded by the map and
  // native surfaces. Keep this lightweight relay on non-map routes without
  // mounting the Map application's own camera/data controller graph.
  React.useEffect(() => startEngagementChips({ demo: false }), [])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <ViewHarness initialView={initialView} />
      {initialView !== 'uploadflows' && <VolumeBars />}
      {initialView !== 'uploadflows' && <PopupHost />}
    </div>
  )
}

export default function App() {
  useAppPresenceReporter()
  const params = new URLSearchParams(window.location.search)
  const mapOnly = params.get('map') === '1'
  if (mapOnly) {
    return (
      <React.Suspense fallback={<MapFallback />}>
        <MapActivityApp />
      </React.Suspense>
    )
  }

  const harnessView = harnessViewFromLocation() ?? 'home'
  return <HarnessApp initialView={harnessView} />
}

function MapActivityApp() {
  useTestActivityReporter('map')
  return <MapApp />
}
