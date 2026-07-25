import './audioGate' // must run before any AudioContext is created
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { isNativeShell } from './nativeBridge'

// perf-lite: inside the native app shell only. The approved look layers
// backdrop-filter blur over live content (feed video, map); that forces a full
// GPU re-composite every frame and measured 5-16fps / 100% janky frames on a
// low-end Android and on iPad's much larger viewport. The browser prototype
// keeps the full look — the app drops the most expensive effects. Applied before
// first paint so there is no flash.
if (isNativeShell()) document.documentElement.classList.add('perf-lite')

// tier-low: 3GB-class devices (navigator.deviceMemory quantizes the A03s to 2;
// iOS never exposes it, 4GB+ Androids report 4+). Measured on Mali-G52: the
// full effect stack runs ~5fps — the lite tier flattens effects, keeps layout.
const deviceMemory = (navigator as unknown as { deviceMemory?: number }).deviceMemory
if (isNativeShell() && typeof deviceMemory === 'number' && deviceMemory <= 2) {
  document.documentElement.classList.add('tier-low')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
