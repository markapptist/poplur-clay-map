import React, { useEffect, useRef } from 'react'
import styles from './RadioScreen.module.css'
import { playRadioPowerOn } from './radioPowerSound'

// POWER ON — the deck warming up.
//
// The clay TV is the app's own render, put through a low-resolution buffer so
// it comes back as chunky pixels: the same object, digitised, the way a
// dashboard screen would draw it. It turns on a plinth and never stops. No new
// artwork is invented here — the source is clay_tv.png.

const PIXELS = 46 // the buffer the TV is redrawn at, before it is scaled up

export default function RadioBoot({ onDone }: { onDone: () => void }) {
  const frontRef = useRef<HTMLCanvasElement>(null)
  const backRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    playRadioPowerOn()
    const t = window.setTimeout(onDone, 2350)
    return () => window.clearTimeout(t)
  }, [onDone])

  // Draw the clay TV once, small, with smoothing on the way down — then the
  // canvas is scaled up by CSS with smoothing off, which is what makes the
  // pixels square instead of soft.
  useEffect(() => {
    const img = new Image()
    img.src = 'clay_tv.png'
    img.onload = () => {
      for (const [ref, flip] of [[frontRef, false], [backRef, true]] as const) {
        const cv = ref.current
        const ctx = cv?.getContext('2d')
        if (!cv || !ctx) continue
        ctx.clearRect(0, 0, PIXELS, PIXELS)
        ctx.save()
        if (flip) { ctx.translate(PIXELS, 0); ctx.scale(-1, 1) }
        ctx.drawImage(img, 0, 0, PIXELS, PIXELS)
        ctx.restore()
        // quantise to the LCD's green-on-dark palette so the TV reads as
        // something the screen itself is drawing
        const px = ctx.getImageData(0, 0, PIXELS, PIXELS)
        const d = px.data
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 40) continue
          const lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255
          const step = Math.round(lum * 4) / 4 // four levels — a cheap panel
          d[i] = Math.round(40 + step * 150)
          d[i + 1] = Math.round(70 + step * 185)
          d[i + 2] = Math.round(38 + step * 120)
          d[i + 3] = 255
        }
        ctx.putImageData(px, 0, 0)
      }
    }
  }, [])

  return (
    <div className={styles.boot} role="status" aria-label="Poplur Radio starting up">
      <span className={styles.bootGrid} aria-hidden="true" />
      <span className={styles.bootGlass} aria-hidden="true" />
      <div className={styles.bootInner}>
        <div className={styles.bootWord}>POPLUR RADIO</div>
        <div className={styles.bootStage} aria-hidden="true">
          <div className={styles.bootTv}>
            <canvas ref={frontRef} width={PIXELS} height={PIXELS} className={styles.bootFace} />
            <canvas ref={backRef} width={PIXELS} height={PIXELS} className={`${styles.bootFace} ${styles.bootFaceBack}`} />
          </div>
          <span className={styles.bootShadow} />
        </div>
        <div className={styles.bootStatus}>
          <span>WARMING UP</span>
          <span className={styles.bootDots}><i /><i /><i /></span>
        </div>
      </div>
    </div>
  )
}
