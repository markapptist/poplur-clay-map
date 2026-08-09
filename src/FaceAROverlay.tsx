import React from 'react'
import type { Detection } from './mlDetect'
import styles from './FaceAROverlay.module.css'

const isFace = (detection: Detection) => {
  return !detection.whole && (
    detection.id === 'face'
    || detection.id.startsWith('face-')
    || Boolean(detection.user)
    || detection.isUser === true
  )
}

export function drawFaceAREffect(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  detections: readonly Detection[],
  filter: string,
) {
  if (filter === 'none') return
  context.save()
  context.filter = 'none'
  context.lineCap = 'round'
  context.lineJoin = 'round'

  for (const face of detections.filter(isFace)) {
    const x = face.x * width
    const y = face.y * height
    const w = face.w * width
    const h = face.h * height
    const eyeY = y + h * 0.42

    if (filter === 'beauty' || filter === 'warm') {
      context.fillStyle = filter === 'warm' ? 'rgba(236,95,42,.28)' : 'rgba(255,65,145,.28)'
      context.filter = `blur(${Math.max(3, w * 0.025)}px)`
      context.beginPath(); context.ellipse(x + w * 0.24, y + h * 0.6, w * 0.11, h * 0.055, 0, 0, Math.PI * 2); context.fill()
      context.beginPath(); context.ellipse(x + w * 0.76, y + h * 0.6, w * 0.11, h * 0.055, 0, 0, Math.PI * 2); context.fill()
      context.filter = 'none'
    }
    if (filter === 'warm') {
      context.fillStyle = 'rgba(92,35,18,.8)'
      for (let index = -3; index <= 3; index++) {
        context.beginPath()
        context.arc(x + w * (0.5 + index * 0.055), y + h * (0.53 + Math.abs(index) * 0.012), Math.max(1.5, w * 0.011), 0, Math.PI * 2)
        context.fill()
      }
    }
    if (filter === 'brighten') {
      context.strokeStyle = 'rgba(255,244,178,.9)'
      context.lineWidth = Math.max(3, w * 0.018)
      context.shadowColor = '#ffe889'; context.shadowBlur = w * 0.08
      context.beginPath(); context.ellipse(x + w * 0.5, y + h * 0.5, w * 0.56, h * 0.6, 0, 0, Math.PI * 2); context.stroke()
      context.shadowBlur = 0
    }
    if (filter === 'glow') {
      context.strokeStyle = '#ffd55d'; context.lineWidth = Math.max(4, w * 0.025)
      context.shadowColor = '#ffc43d'; context.shadowBlur = w * 0.07
      context.beginPath(); context.ellipse(x + w * 0.5, y - h * 0.12, w * 0.38, h * 0.07, -0.07, 0, Math.PI * 2); context.stroke()
      context.shadowBlur = 0
    }
    if (filter === 'sharpen') {
      context.fillStyle = 'rgba(25,212,245,.3)'; context.strokeStyle = '#63f4ff'; context.lineWidth = Math.max(3, w * 0.018)
      const visorX = x - w * 0.03; const visorY = eyeY - h * 0.11; const visorW = w * 1.06; const visorH = h * 0.24
      context.beginPath(); context.roundRect(visorX, visorY, visorW, visorH, visorH * 0.3); context.fill(); context.stroke()
      context.beginPath(); context.moveTo(x + w * 0.5, visorY); context.lineTo(x + w * 0.5, visorY + visorH); context.stroke()
    }
    if (filter === 'cool') {
      const heights = [0.16, 0.23, 0.31, 0.23, 0.16]
      context.fillStyle = 'rgba(89,205,255,.88)'; context.shadowColor = '#7fddff'; context.shadowBlur = w * 0.04
      heights.forEach((scale, index) => {
        const crystalX = x + w * (0.13 + index * 0.15)
        const crystalW = w * 0.14
        const crystalH = h * scale
        const baseY = y - h * 0.01
        context.beginPath()
        context.moveTo(crystalX + crystalW * 0.5, baseY - crystalH)
        context.lineTo(crystalX + crystalW, baseY - crystalH * 0.35)
        context.lineTo(crystalX + crystalW * 0.76, baseY)
        context.lineTo(crystalX + crystalW * 0.24, baseY)
        context.lineTo(crystalX, baseY - crystalH * 0.35)
        context.closePath(); context.fill()
      })
      context.shadowBlur = 0
    }
    if (filter === 'vintage') {
      context.strokeStyle = '#25140d'; context.lineWidth = Math.max(5, w * 0.035)
      context.beginPath(); context.ellipse(x + w * 0.29, eyeY, w * 0.22, h * 0.14, 0, 0, Math.PI * 2); context.stroke()
      context.beginPath(); context.ellipse(x + w * 0.71, eyeY, w * 0.22, h * 0.14, 0, 0, Math.PI * 2); context.stroke()
      context.beginPath(); context.moveTo(x + w * 0.49, eyeY); context.lineTo(x + w * 0.51, eyeY); context.stroke()
    }
  }
  context.restore()
}

function FaceEffect({ filter }: { filter: string }) {
  return (
    <>
      <span className={`${styles.skinMask} ${styles[`skin_${filter}`] ?? ''}`} />
      {filter === 'beauty' && (
        <>
          <span className={`${styles.blush} ${styles.blushLeft}`} />
          <span className={`${styles.blush} ${styles.blushRight}`} />
          <span className={`${styles.sparkle} ${styles.sparkleOne}`} />
          <span className={`${styles.sparkle} ${styles.sparkleTwo}`} />
        </>
      )}
      {filter === 'brighten' && <span className={styles.lightRing} />}
      {filter === 'glow' && (
        <>
          <span className={styles.halo} />
          <span className={`${styles.sparkle} ${styles.sparkleOne}`} />
          <span className={`${styles.sparkle} ${styles.sparkleTwo}`} />
          <span className={`${styles.sparkle} ${styles.sparkleThree}`} />
        </>
      )}
      {filter === 'sharpen' && (
        <span className={styles.visor}>
          <span className={styles.visorBridge} />
        </span>
      )}
      {filter === 'warm' && (
        <>
          <span className={`${styles.blush} ${styles.blushLeft}`} />
          <span className={`${styles.blush} ${styles.blushRight}`} />
          <span className={styles.freckles} />
        </>
      )}
      {filter === 'cool' && (
        <span className={styles.crystalCrown}>
          <span /><span /><span /><span /><span />
        </span>
      )}
      {filter === 'vintage' && (
        <span className={styles.glasses}>
          <span className={styles.lensLeft} />
          <span className={styles.lensRight} />
          <span className={styles.glassesBridge} />
        </span>
      )}
    </>
  )
}

export default function FaceAROverlay({
  detections,
  filter,
  mirrored,
}: {
  detections: readonly Detection[]
  filter: string
  mirrored: boolean
}) {
  if (filter === 'none') return null
  const faces = detections.filter(isFace)
  if (faces.length === 0) return null

  return (
    <div
      className={styles.layer}
      style={mirrored ? { transform: 'scaleX(-1)' } : undefined}
      aria-hidden="true"
    >
      {faces.map(face => (
        <div
          key={face.id}
          className={styles.face}
          style={{
            left: `${face.x * 100}%`,
            top: `${face.y * 100}%`,
            width: `${face.w * 100}%`,
            height: `${face.h * 100}%`,
          }}
        >
          <FaceEffect filter={filter} />
        </div>
      ))}
    </div>
  )
}
