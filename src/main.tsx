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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
