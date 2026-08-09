import React from 'react'
import type { Detection } from './mlDetect'
import FaceAR3D, { hasFaceAR3D } from './FaceAR3D'
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
        </>
      )}
      {filter === 'warm' && (
        <>
          <span className={`${styles.blush} ${styles.blushLeft}`} />
          <span className={`${styles.blush} ${styles.blushRight}`} />
          <span className={styles.freckles} />
        </>
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

  return (
    <div
      className={styles.layer}
      style={mirrored ? { transform: 'scaleX(-1)' } : undefined}
      aria-hidden="true"
    >
      {hasFaceAR3D(filter) && <FaceAR3D detections={faces} filter={filter} />}
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
