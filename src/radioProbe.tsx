import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'

// capture every Audio the deck constructs (they are never attached to the DOM)
const created: HTMLAudioElement[] = []
const Native = window.Audio
;(window as unknown as { Audio: unknown }).Audio = function (this: unknown, ...args: unknown[]) {
  // @ts-expect-error probe shim
  const el = new Native(...args)
  created.push(el)
  return el
}
;(window as unknown as { __audios: HTMLAudioElement[] }).__audios = created

import('./RadioScreen').then(({ default: RadioScreen }) => {
  function Probe() {
    const [open, setOpen] = useState(true)
    ;(window as unknown as { __closeDeck: () => void }).__closeDeck = () => setOpen(false)
    return open ? <RadioScreen onClose={() => setOpen(false)} /> : <div id="closed" style={{ color: '#fff' }}>closed</div>
  }
  createRoot(document.getElementById('root')!).render(<Probe />)
})
