import { modelSprite } from './modelSprite'

// ── The pop pin: a Poplur pin wearing the poster's face ─────────────────────
//
// A claim already recolours the GROUND it holds (mapClaims). That answers "how
// much", but not "whose" — and once the map shows other people's takeovers side
// by side, whose is the whole question. The pin is the answer: the supplied
// `poplur_pin.glb`, with the owner's profile picture set into the round head
// where the embossed P sits.
//
// TWO VIEWS OF ONE MODEL, because the map has two render tiers and a marker
// that ignores the tier looks pasted on:
//   3D mode — an angled camera (yaw 20°, pitch 14°), so the pin has a visible
//             side and reads as an object standing on the pitched world, the
//             same framing the clay props/zoom stages use.
//   2D mode — dead-on (yaw 0, pitch 0): a flat badge over a flat map. The tilt
//             is what would look wrong here, not the shading.
// Same GLB, same lights, same fitting — only the camera differs, so the two can
// never drift into looking like different pins.
//
// PERFORMANCE: modelSprite is prerender-backed (see spritePrerender.json). Both
// views MUST be baked by .codex/prerender-sprites.mjs — poplur_pin.glb is 29MB
// and a runtime decode of it on the map is exactly the cost that module's
// header warns about. The avatar composite below is a 2D canvas draw over the
// baked PNG, so a face costs a blit, not a model.

export const PIN_SPRITE_SIZE = 256

/** The pin model, framed for a map tier. Prerendered — see the note above. */
export function pinSprite(mode: '2d' | '3d'): Promise<string> {
  return mode === '3d'
    ? modelSprite('models/poplur_pin.glb', { yaw: 20, pitch: 14, size: PIN_SPRITE_SIZE })
    : modelSprite('models/poplur_pin.glb', { yaw: 0, pitch: 0, size: PIN_SPRITE_SIZE })
}

/**
 * Where the face goes, as fractions of the pin's OWN alpha bounds rather than
 * of the sprite box. modelSprite fits the model to the frame, but the two
 * camera views do not land on identical pixels, and hard-coding sprite-box
 * fractions put the face off-centre on the angled one. Measuring the pin and
 * working in its local box makes the same numbers correct for both views.
 */
const HEAD_CENTRE_Y = 0.335 // down from the top of the pin
const HEAD_RADIUS = 0.30    // of the pin's width

interface Bounds { x: number; y: number; w: number; h: number }

/** Tight alpha bounds of the drawn pin inside its transparent sprite box. */
function alphaBounds(ctx: CanvasRenderingContext2D, size: number): Bounds {
  const { data } = ctx.getImageData(0, 0, size, size)
  let minX = size, minY = size, maxX = -1, maxY = -1
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // 24 not 0: the model's soft edge fades out over a few pixels, and
      // counting those made the box a couple of pixels too generous on every
      // side — enough to walk the face off the head.
      if (data[(y * size + x) * 4 + 3] <= 24) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: size, h: size }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`pin asset failed: ${src}`))
    // Avatars are same-origin (bundled stills) or data URIs (the user's own
    // capture). crossOrigin keeps the canvas untainted either way, so
    // toDataURL below cannot throw a security error.
    img.crossOrigin = 'anonymous'
    img.src = src
  })
}

const composed = new Map<string, Promise<string>>()

export interface PinFace {
  /** Profile picture: a bundled still, or the owner's own data URI. */
  avatar: string | null
  /** The pop's takeover colour — the rim around the face ties the pin to the
   *  ground it holds, which is how you read two overlapping claims apart. */
  color: string
  mode: '2d' | '3d'
}

/**
 * A pin sprite with `face.avatar` set into its head, as a data URI.
 *
 * Cached by (mode, avatar, colour): the map draws one marker per pop and a
 * screenful of pops from the same person is one composite, not thirty.
 */
export function pinWithFace(face: PinFace): Promise<string> {
  const key = `${face.mode}|${face.avatar ?? 'none'}|${face.color}`
  let job = composed.get(key)
  if (!job) {
    job = compose(face).catch(() => pinSprite(face.mode))
    composed.set(key, job)
  }
  return job
}

async function compose(face: PinFace): Promise<string> {
  const size = PIN_SPRITE_SIZE
  const base = await pinSprite(face.mode)
  const pin = await loadImage(base)

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return base
  ctx.drawImage(pin, 0, 0, size, size)

  const box = alphaBounds(ctx, size)
  // Bake the outline and lighting into the cached sprite. Doing this once in
  // the compositor is much cheaper than asking WebKit to maintain several
  // live CSS drop-shadow filters for every pin while the map moves.
  const silhouette = document.createElement('canvas')
  silhouette.width = size
  silhouette.height = size
  const silhouetteCtx = silhouette.getContext('2d')
  if (silhouetteCtx) {
    silhouetteCtx.drawImage(pin, 0, 0, size, size)
    silhouetteCtx.globalCompositeOperation = 'source-in'
    silhouetteCtx.fillStyle = 'rgba(32, 5, 25, 0.98)'
    silhouetteCtx.fillRect(0, 0, size, size)

    ctx.clearRect(0, 0, size, size)
    const rim = Math.max(3, Math.round(box.w * 0.035))
    ;[
      [-rim, 0], [rim, 0], [0, -rim], [0, rim],
      [-rim, -rim], [rim, -rim], [-rim, rim], [rim, rim],
    ].forEach(([x, y]) => ctx.drawImage(silhouette, x, y))
    // A thin top-left key light is the clay shader's bright edge; the dark
    // silhouette still remains visible on every other side over pink terrain.
    silhouetteCtx.globalCompositeOperation = 'source-in'
    silhouetteCtx.fillStyle = 'rgba(255, 238, 249, 0.9)'
    silhouetteCtx.fillRect(0, 0, size, size)
    ctx.drawImage(silhouette, -Math.ceil(rim * 0.45), -Math.ceil(rim * 0.45))
    ctx.drawImage(pin, 0, 0, size, size)

    // Static directional shader: highlight upper-left, deepen lower-right.
    // source-atop confines it to the pin/outline alpha and adds zero map-frame
    // work after this cached PNG has been produced.
    ctx.globalCompositeOperation = 'source-atop'
    const shader = ctx.createLinearGradient(box.x, box.y, box.x + box.w, box.y + box.h)
    shader.addColorStop(0, 'rgba(255, 255, 255, 0.28)')
    shader.addColorStop(0.46, 'rgba(255, 255, 255, 0)')
    shader.addColorStop(1, 'rgba(26, 0, 19, 0.32)')
    ctx.fillStyle = shader
    ctx.fillRect(box.x - rim, box.y - rim, box.w + rim * 2, box.h + rim * 2)
    ctx.globalCompositeOperation = 'source-over'
  }
  const cx = box.x + box.w / 2
  const cy = box.y + box.h * HEAD_CENTRE_Y
  const r = box.w * HEAD_RADIUS

  // No avatar yet (nobody has set a picture): leave the pin as the artist drew
  // it, embossed P and all. A blank grey disc over the P would look like a
  // broken image, and inventing a placeholder face is not ours to do.
  if (!face.avatar) return canvas.toDataURL('image/png')

  const avatar = await loadImage(face.avatar)

  // Sink the head: the model's P is a RECESS, so the face has to sit in a
  // socket or it reads as a sticker on top of the pin. A soft inner shadow
  // around the disc is what sells the depth on both camera views.
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()
  // Cover-fit the (usually square) avatar into the circle without distorting.
  const scale = Math.max((r * 2) / avatar.width, (r * 2) / avatar.height)
  const dw = avatar.width * scale
  const dh = avatar.height * scale
  ctx.drawImage(avatar, cx - dw / 2, cy - dh / 2, dw, dh)
  const socket = ctx.createRadialGradient(cx, cy, r * 0.62, cx, cy, r)
  socket.addColorStop(0, 'rgba(0, 0, 0, 0)')
  socket.addColorStop(1, 'rgba(0, 0, 0, 0.55)')
  ctx.fillStyle = socket
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
  ctx.restore()

  // The owner's colour, as the ring around the face. A dark outer keyline and
  // a short white highlight keep the face readable over either map palette.
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.97, 0, Math.PI * 2)
  ctx.lineWidth = Math.max(5, r * 0.2)
  ctx.strokeStyle = 'rgba(35, 5, 28, 0.95)'
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.97, 0, Math.PI * 2)
  ctx.lineWidth = Math.max(3, r * 0.13)
  ctx.strokeStyle = face.color
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.97, Math.PI * 1.08, Math.PI * 1.72)
  ctx.lineWidth = Math.max(2, r * 0.045)
  ctx.strokeStyle = 'rgba(255, 245, 251, 0.9)'
  ctx.stroke()
  ctx.restore()

  return canvas.toDataURL('image/png')
}

/** Warm both tiers so the first pins do not pop in a frame late. */
export function warmPinSprites(): void {
  void pinSprite('3d').catch(() => {})
  void pinSprite('2d').catch(() => {})
}
