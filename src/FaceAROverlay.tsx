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
      {filter === 'puppy-love' && (
        <>
          <span className={`${styles.blush} ${styles.blushLeft}`} />
          <span className={`${styles.blush} ${styles.blushRight}`} />
        </>
      )}
      <Costume filter={filter} />
    </>
  )
}

/**
 * The costume, drawn over the face box.
 *
 * One SVG per filter rather than a pile of positioned spans: these are shapes,
 * not rectangles, and an SVG scales with the box for free. The canvas sits
 * ABOVE the face — `.costume` extends 45% of the face height upward — because
 * most of this set is head-worn and a crown has nowhere to go inside the box.
 *
 * Coordinates are a 0–100 square in that extended space, which puts the face
 * at x 11.5–88.5 and y 30–97. Working landmarks, consistent across every
 * costume below: head top y30, eyes y57, nose y68, chin y95, centre x50.
 *
 * These are BOX-anchored, not landmark-anchored — the web detector gives a
 * rectangle and nothing finer. iOS has Vision landmarks and should place the
 * nose and eye pieces from those instead; the two that will notice the
 * difference are puppy-love and inferno-eyes.
 */
function Costume({ filter }: { filter: string }) {
  const art = () => {
    switch (filter) {
      case 'puppy-love':
        return (
          <>
            {/* floppy ears, hung off the top corners of the head */}
            <path d="M22 34 C10 30 4 44 8 58 C11 70 22 72 26 62 C29 53 28 41 22 34 Z" fill="#b9702f" />
            <path d="M78 34 C90 30 96 44 92 58 C89 70 78 72 74 62 C71 53 72 41 78 34 Z" fill="#b9702f" />
            <path d="M23 40 C15 38 11 47 14 57 C16 65 23 66 25 59 C27 52 26 44 23 40 Z" fill="#e0a166" />
            <path d="M77 40 C85 38 89 47 86 57 C84 65 77 66 75 59 C73 52 74 44 77 40 Z" fill="#e0a166" />
            {/* nose */}
            <ellipse cx="50" cy="68" rx="7" ry="5.2" fill="#2f2028" />
            <ellipse cx="47.6" cy="66.4" rx="2" ry="1.4" fill="rgba(255,255,255,0.5)" />
          </>
        )
      case 'butterfly-dream':
        return (
          <>
            {[[20, 44, -18, 1], [76, 38, 16, 0.9], [30, 74, 12, 0.7], [70, 70, -10, 0.75]].map(
              ([cx, cy, rot, s], i) => (
                <g key={i} transform={`translate(${cx} ${cy}) rotate(${rot}) scale(${s})`} opacity="0.92">
                  <path d="M0 0 C-9 -10 -16 -6 -13 3 C-11 9 -4 8 0 0 Z" fill="#a97bff" />
                  <path d="M0 0 C9 -10 16 -6 13 3 C11 9 4 8 0 0 Z" fill="#7fd0ff" />
                  <path d="M0 0 C-7 4 -9 10 -4 11 C-1 11 0 6 0 0 Z" fill="#c9a5ff" />
                  <path d="M0 0 C7 4 9 10 4 11 C1 11 0 6 0 0 Z" fill="#a8e4ff" />
                  <ellipse cx="0" cy="1" rx="1.1" ry="5" fill="#3a2260" />
                </g>
              ),
            )}
          </>
        )
      case 'inferno-eyes':
        return (
          <g>
            {[35, 65].map(cx => (
              <g key={cx}>
                <ellipse cx={cx} cy="57" rx="11" ry="7" fill="url(#ember)" opacity="0.95" />
                <ellipse cx={cx} cy="57" rx="5" ry="3.2" fill="#fff3c4" />
              </g>
            ))}
          </g>
        )
      case 'heart-crown':
        return (
          <>
            {[[26, 22, 0.75], [38, 13, 1], [50, 9, 1.2], [62, 13, 1], [74, 22, 0.75]].map(
              ([cx, cy, s], i) => (
                <path
                  key={i}
                  transform={`translate(${cx} ${cy}) scale(${s})`}
                  d="M0 7 C-8 1 -8 -6 -3.4 -6 C-1.3 -6 0 -4.4 0 -3 C0 -4.4 1.3 -6 3.4 -6 C8 -6 8 1 0 7 Z"
                  fill="#ff3ba7"
                />
              ),
            )}
          </>
        )
      case 'dino-hood':
        return (
          <>
            <path d="M11 52 C11 22 89 22 89 52 C89 34 78 26 50 26 C22 26 11 34 11 52 Z" fill="#4bbf3f" />
            <path d="M8 54 C8 20 92 20 92 54 L92 62 C92 34 8 34 8 62 Z" fill="#57d84a" />
            {[[38, 20], [50, 15], [62, 20]].map(([x, y], i) => (
              <path key={i} d={`M${x - 6} ${y + 12} L${x} ${y} L${x + 6} ${y + 12} Z`} fill="#ffb02e" />
            ))}
          </>
        )
      case 'angel':
        return (
          <>
            <ellipse cx="50" cy="15" rx="21" ry="6" fill="none" stroke="#ffd964" strokeWidth="4" />
            <ellipse cx="50" cy="15" rx="21" ry="6" fill="none" stroke="rgba(255,246,196,0.85)" strokeWidth="1.4" />
            <path d="M14 56 C-2 44 -2 74 16 82 C24 85 26 70 14 56 Z" fill="rgba(255,255,255,0.55)" />
            <path d="M86 56 C102 44 102 74 84 82 C76 85 74 70 86 56 Z" fill="rgba(255,255,255,0.55)" />
          </>
        )
      case 'flower-crown':
        return (
          <>
            {[[18, 34, 0.8], [30, 25, 1], [43, 20, 1.1], [57, 20, 1.1], [70, 25, 1], [82, 34, 0.8]].map(
              ([cx, cy, s], i) => (
                <g key={i} transform={`translate(${cx} ${cy}) scale(${s})`}>
                  {[0, 72, 144, 216, 288].map(a => (
                    <ellipse
                      key={a}
                      cx="0"
                      cy="-5"
                      rx="3.4"
                      ry="5"
                      transform={`rotate(${a})`}
                      fill={i % 2 ? '#ffd7e6' : '#ff9ec4'}
                    />
                  ))}
                  <circle cx="0" cy="0" r="2.6" fill="#ffd964" />
                </g>
              ),
            )}
          </>
        )
      default:
        return null
    }
  }
  const art_ = art()
  if (!art_) return null
  return (
    <svg className={styles.costume} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <radialGradient id="ember">
          <stop offset="0%" stopColor="#fff6cf" />
          <stop offset="45%" stopColor="#ff9d2e" />
          <stop offset="100%" stopColor="rgba(255,72,0,0)" />
        </radialGradient>
      </defs>
      {art_}
    </svg>
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
