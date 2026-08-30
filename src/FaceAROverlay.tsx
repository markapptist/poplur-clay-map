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

const usablePoint = (point: { x: number, y: number } | undefined) => {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
    ? point
    : null
}

/** Ids whose costume the canvas painter below knows how to draw. */
const CANVAS_COSTUMES = new Set([
  'puppy-love', 'butterfly-dream', 'inferno-eyes',
  'heart-crown', 'dino-hood', 'angel', 'flower-crown',
])

/** True when the captured-photo painter has artwork for this filter. */
export const hasCaptureCostume = (filter: string) => CANVAS_COSTUMES.has(filter)

/** Web-authored pixel values are quoted at the ~390pt reference width, the same
 *  convention `applyAnaglyphToCanvas` rescales by, so a 4K still gets a shadow
 *  and a blush in the proportion the viewfinder showed them. */
const refScale = (frameWidth: number) => frameWidth / 390

/**
 * Bake the AR costume into a CAPTURED frame.
 *
 * The live viewfinder wears its costume as SVG (`Costume`, below). The capture
 * path has only a 2D context, and for a long time it knew how to paint just two
 * ids — `beauty` and `warm` — both of which were retired when the rail was
 * rebuilt from the filter sheet. So every shipping costume was lost on the way
 * to the roll: you framed a shot in puppy ears and saved the colour grade with
 * no ears, which is precisely what the capture path promises never to happen.
 *
 * Every `d` string, colour and coordinate below is COPIED from the SVG cases
 * verbatim rather than re-derived. Two renderers of the same costume must not
 * be able to drift into two different costumes.
 *
 * `mirrored` is the front camera, and it is a PARAMETER rather than something
 * read off the incoming context on purpose: the capture path leaves its mirror
 * transform in place on the plain-grade branch but resets it before the
 * pixel-level anaglyph pass, so the context's own state is not a reliable
 * account of which way the saved frame faces. Painting takes the frame's own
 * coordinates and re-applies the mirror deliberately, which lands the costume
 * on the face — and mirrors the artwork with it, exactly as the live overlay's
 * `scaleX(-1)` layer does — on both branches.
 */
export function drawFaceAREffect(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  detections: readonly Detection[],
  filter: string,
  mirrored: boolean,
) {
  if (filter === 'none' || !CANVAS_COSTUMES.has(filter)) return
  const faces = detections.filter(isFace)
  if (faces.length === 0) return

  context.save()
  context.setTransform(1, 0, 0, 1, 0, 0)
  // The grade rode in on `ctx.filter` and is already baked into the pixels
  // underneath. The costume goes on top of it ungraded — same as the live
  // overlay, which is a sibling of the video rather than inside its filter —
  // or a sepia visor would be sepia'd twice.
  context.filter = 'none'
  context.lineCap = 'round'
  context.lineJoin = 'round'
  if (mirrored) { context.translate(width, 0); context.scale(-1, 1) }

  // One scratch canvas for every face in the frame, not one each.
  let buffer: HTMLCanvasElement | null = null
  for (const face of faces) {
    const x = face.x * width
    const y = face.y * height
    const w = face.w * width
    const h = face.h * height
    if (filter === 'puppy-love') drawBlush(context, face, x, y, w, h, width)
    buffer = drawCostumeOnCanvas(context, filter, x, y, w, h, width, height, buffer)
  }
  context.restore()
}

/**
 * `.blush` — puppy-love's cheeks, the one piece of the live costume that lives
 * outside the `Costume` SVG. 22%×11% of the face box, top 57%, inset 12% from
 * each side, under its own 4px blur (per-span in CSS, so per-shape here too).
 */
function drawBlush(
  c: CanvasRenderingContext2D,
  face: Detection,
  x: number, y: number, w: number, h: number, frameWidth: number,
) {
  c.save()
  c.fillStyle = 'rgba(255,73,151,0.34)'
  c.filter = `blur(${Math.max(1, 4 * refScale(frameWidth))}px)`
  const nose = usablePoint(face.landmarks?.nose)
  const leftEye = usablePoint(face.landmarks?.leftEye)
  const rightEye = usablePoint(face.landmarks?.rightEye)
  // With real landmarks, follow the nose vertically and place each cheek
  // between its eye and the nose. Browser/Android detections retain the exact
  // bounding-box fallback when they do not supply a landmark track.
  const cheekY = nose ? nose.y * c.canvas.height : y + h * 0.625
  const cheeks = nose && leftEye && rightEye
    ? [
        (leftEye.x * 0.72 + nose.x * 0.28) * c.canvas.width,
        (rightEye.x * 0.72 + nose.x * 0.28) * c.canvas.width,
      ]
    : [x + w * 0.23, x + w * 0.77]
  for (const cx of cheeks) {
    c.beginPath()
    c.ellipse(cx, cheekY, w * 0.11, h * 0.055, 0, 0, Math.PI * 2)
    c.fill()
  }
  c.restore()
}

/** Buffer bigger than this and the costume is rendered scaled down and blitted
 *  up. Vector art survives that; a full-resolution RGBA scratch canvas on a
 *  12MP still — 48MB, at the moment a phone is already holding the capture —
 *  does not deserve to be allocated for a drop shadow. */
const MAX_COSTUME_BUFFER_PX = 4_194_304

/**
 * Place and paint one costume, matching `.costume`'s box exactly.
 *
 * The SVG sits at left:-15% top:-45% width:130% height:150% of the face box —
 * head-worn artwork has nowhere to go inside a face rectangle — and carries
 * `viewBox="0 0 100 100"` with no `preserveAspectRatio`, so the default
 * `xMidYMid meet` applies: a UNIFORM fit, centred in that box, never a stretch.
 * Reproducing the fit rather than stretching 0–100 across the box is what makes
 * the saved costume land where the viewfinder had it.
 *
 * Everything goes through a scratch canvas so `.costume`'s
 * `drop-shadow(0 2px 4px …)` composites once over the whole costume, the way
 * CSS applies it. Drawn shape by shape into the frame it would instead fall
 * from every ear onto the ear behind it.
 */
function drawCostumeOnCanvas(
  target: CanvasRenderingContext2D,
  filter: string,
  x: number, y: number, w: number, h: number,
  frameWidth: number, frameHeight: number,
  buffer: HTMLCanvasElement | null,
): HTMLCanvasElement | null {
  const boxW = w * 1.3
  const boxH = h * 1.5
  const unit = Math.min(boxW, boxH) / 100
  if (!(unit > 0)) return buffer
  const originX = (x - w * 0.15) + (boxW - unit * 100) / 2
  const originY = (y - h * 0.45) + (boxH - unit * 100) / 2

  const shadowBlur = 4 * refScale(frameWidth)
  const shadowDrop = 2 * refScale(frameWidth)
  // `overflow: visible` on the SVG, and several costumes use it — the angel's
  // wings reach past both edges of the 0–100 square. Pad for that and for the
  // shadow, then clip to the frame: nothing outside it can be saved anyway.
  const pad = unit * 10 + shadowBlur + shadowDrop
  const left = Math.max(0, Math.floor(originX - pad))
  const top = Math.max(0, Math.floor(originY - pad))
  const right = Math.min(frameWidth, Math.ceil(originX + unit * 100 + pad))
  const bottom = Math.min(frameHeight, Math.ceil(originY + unit * 100 + pad))
  const boundsW = right - left
  const boundsH = bottom - top
  if (boundsW <= 0 || boundsH <= 0) return buffer

  const quality = Math.min(1, Math.sqrt(MAX_COSTUME_BUFFER_PX / (boundsW * boundsH)))
  const canvas = buffer ?? document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(boundsW * quality))
  canvas.height = Math.max(1, Math.ceil(boundsH * quality))
  const c = canvas.getContext('2d')
  if (!c) return canvas
  c.clearRect(0, 0, canvas.width, canvas.height)
  c.lineCap = 'round'
  c.lineJoin = 'round'
  c.setTransform(quality, 0, 0, quality, -left * quality, -top * quality)
  c.translate(originX, originY)
  c.scale(unit, unit)
  paintCostume(c, filter)

  target.save()
  target.shadowColor = 'rgba(0,0,0,0.45)'
  target.shadowBlur = shadowBlur
  // Shadow offsets are not touched by the transform, so this stays a downward
  // shadow under the front camera's mirror — as it is in the live overlay.
  target.shadowOffsetY = shadowDrop
  target.drawImage(canvas, left, top, boundsW, boundsH)
  target.restore()
  return canvas
}

/**
 * The costume itself, in `Costume`'s own 0–100 space: face at x 11.5–88.5 and
 * y 30–97, head top y30, eyes y57, nose y68, chin y95, centre x50.
 */
function paintCostume(c: CanvasRenderingContext2D, filter: string): void {
  const fill = (d: string, style: string) => {
    c.fillStyle = style
    c.fill(new Path2D(d))
  }
  const oval = (cx: number, cy: number, rx: number, ry: number, style: string) => {
    c.fillStyle = style
    c.beginPath()
    c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    c.fill()
  }
  switch (filter) {
    case 'puppy-love':
      // floppy ears, hung off the top corners of the head
      fill('M22 34 C10 30 4 44 8 58 C11 70 22 72 26 62 C29 53 28 41 22 34 Z', '#b9702f')
      fill('M78 34 C90 30 96 44 92 58 C89 70 78 72 74 62 C71 53 72 41 78 34 Z', '#b9702f')
      fill('M23 40 C15 38 11 47 14 57 C16 65 23 66 25 59 C27 52 26 44 23 40 Z', '#e0a166')
      fill('M77 40 C85 38 89 47 86 57 C84 65 77 66 75 59 C73 52 74 44 77 40 Z', '#e0a166')
      // nose
      oval(50, 68, 7, 5.2, '#2f2028')
      oval(47.6, 66.4, 2, 1.4, 'rgba(255,255,255,0.5)')
      return
    case 'butterfly-dream':
      for (const [cx, cy, rot, s] of [[20, 44, -18, 1], [76, 38, 16, 0.9], [30, 74, 12, 0.7], [70, 70, -10, 0.75]]) {
        c.save()
        c.translate(cx, cy)
        c.rotate((rot * Math.PI) / 180)
        c.scale(s, s)
        // The SVG puts `opacity` on the <g>, which composites the whole
        // butterfly once. Per-shape alpha differs only where the 2-unit body
        // crosses its own wings, by ~7% of that edge — under a nested group
        // buffer's worth of machinery, and invisible.
        c.globalAlpha = 0.92
        fill('M0 0 C-9 -10 -16 -6 -13 3 C-11 9 -4 8 0 0 Z', '#a97bff')
        fill('M0 0 C9 -10 16 -6 13 3 C11 9 4 8 0 0 Z', '#7fd0ff')
        fill('M0 0 C-7 4 -9 10 -4 11 C-1 11 0 6 0 0 Z', '#c9a5ff')
        fill('M0 0 C7 4 9 10 4 11 C1 11 0 6 0 0 Z', '#a8e4ff')
        oval(0, 1, 1.1, 5, '#3a2260')
        c.restore()
      }
      return
    case 'inferno-eyes':
      for (const cx of [35, 65]) {
        c.save()
        // `url(#ember)` is an objectBoundingBox radial gradient: a circle in
        // the shape's own unit square, which the box mapping stretches into an
        // ellipse with the shape's own radii. Scaling the context reproduces
        // that; `createRadialGradient` alone only draws circles.
        c.translate(cx, 57)
        c.scale(11, 7)
        const ember = c.createRadialGradient(0, 0, 0, 0, 0, 1)
        ember.addColorStop(0, '#fff6cf')
        ember.addColorStop(0.45, '#ff9d2e')
        ember.addColorStop(1, 'rgba(255,72,0,0)')
        c.globalAlpha = 0.95
        c.fillStyle = ember
        c.beginPath()
        c.arc(0, 0, 1, 0, Math.PI * 2)
        c.fill()
        c.restore()
        oval(cx, 57, 5, 3.2, '#fff3c4')
      }
      return
    case 'heart-crown':
      for (const [cx, cy, s] of [[26, 22, 0.75], [38, 13, 1], [50, 9, 1.2], [62, 13, 1], [74, 22, 0.75]]) {
        c.save()
        c.translate(cx, cy)
        c.scale(s, s)
        fill('M0 7 C-8 1 -8 -6 -3.4 -6 C-1.3 -6 0 -4.4 0 -3 C0 -4.4 1.3 -6 3.4 -6 C8 -6 8 1 0 7 Z', '#ff3ba7')
        c.restore()
      }
      return
    case 'dino-hood':
      fill('M11 52 C11 22 89 22 89 52 C89 34 78 26 50 26 C22 26 11 34 11 52 Z', '#4bbf3f')
      fill('M8 54 C8 20 92 20 92 54 L92 62 C92 34 8 34 8 62 Z', '#57d84a')
      for (const [sx, sy] of [[38, 20], [50, 15], [62, 20]]) {
        fill(`M${sx - 6} ${sy + 12} L${sx} ${sy} L${sx + 6} ${sy + 12} Z`, '#ffb02e')
      }
      return
    case 'angel': {
      const halo = (stroke: string, lineWidth: number) => {
        c.strokeStyle = stroke
        c.lineWidth = lineWidth
        c.beginPath()
        c.ellipse(50, 15, 21, 6, 0, 0, Math.PI * 2)
        c.stroke()
      }
      halo('#ffd964', 4)
      halo('rgba(255,246,196,0.85)', 1.4)
      fill('M14 56 C-2 44 -2 74 16 82 C24 85 26 70 14 56 Z', 'rgba(255,255,255,0.55)')
      fill('M86 56 C102 44 102 74 84 82 C76 85 74 70 86 56 Z', 'rgba(255,255,255,0.55)')
      return
    }
    case 'flower-crown':
      for (const [i, [cx, cy, s]] of [[18, 34, 0.8], [30, 25, 1], [43, 20, 1.1], [57, 20, 1.1], [70, 25, 1], [82, 34, 0.8]].entries()) {
        c.save()
        c.translate(cx, cy)
        c.scale(s, s)
        const petal = i % 2 ? '#ffd7e6' : '#ff9ec4'
        for (const a of [0, 72, 144, 216, 288]) {
          c.save()
          c.rotate((a * Math.PI) / 180)
          oval(0, -5, 3.4, 5, petal)
          c.restore()
        }
        oval(0, 0, 2.6, 2.6, '#ffd964')
        c.restore()
      }
      return
    default:
      return
  }
}

function FaceEffect({ filter }: { filter: string }) {
  // The per-filter skin tints below are keyed by id, and the rail's ids were
  // all replaced — so every lookup missed and the bare `.skinMask` rendered on
  // its own: a generic blur-and-pink blob on the face, identical for all
  // fifteen filters and plain wrong under the ones that sharpen (Comic Pop,
  // Chrome Shine). No tint of its own means no mask at all; the filter's grade
  // still covers the whole frame either way.
  const skin = styles[`skin_${filter}`]
  return (
    <>
      {skin && <span className={`${styles.skinMask} ${skin}`} />}
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
 * These retain a box-based drawing frame so browser and Android fallbacks work
 * without a face mesh. On iOS, Vision eye/nose centres travel through the
 * bridge and improve the root and facial-feature anchors instead of being
 * discarded at the native boundary.
 *
 * `paintCostume` above is the same set traced into a 2D context for captured
 * stills. Change a shape here and change it there in the same edit, or the
 * photo stops matching the viewfinder that framed it.
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
  allow3D = true,
}: {
  detections: readonly Detection[]
  filter: string
  mirrored: boolean
  allow3D?: boolean
}) {
  if (filter === 'none') return null
  const faces = detections.filter(isFace)

  return (
    <div
      className={styles.layer}
      style={mirrored ? { transform: 'scaleX(-1)' } : undefined}
      aria-hidden="true"
    >
      {allow3D && hasFaceAR3D(filter) && <FaceAR3D detections={faces} filter={filter} />}
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
