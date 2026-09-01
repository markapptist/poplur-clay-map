import { modelSprite } from './modelSprite'
import { pinModelFor, type PinColorId } from './pinColors'

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

/** The pin model, framed for a map tier. Prerendered — see the note above.
 *  `pinColor` swaps in one of the supplied coloured pin models; the default
 *  remains the original pink pin. */
export function pinSprite(mode: '2d' | '3d', pinColor: PinColorId | null = null): Promise<string> {
  const model = pinModelFor(pinColor)
  return mode === '3d'
    ? modelSprite(model, { yaw: 20, pitch: 14, size: PIN_SPRITE_SIZE })
    : modelSprite(model, { yaw: 0, pitch: 0, size: PIN_SPRITE_SIZE })
}

/**
 * Where the picture goes, as fractions of the pin's OWN alpha bounds.
 *
 * THE MODEL HAS NO SOCKET. It is easy to read `poplur_pin.glb` as a pin with a
 * round hole waiting for a face, but the recess IS the letter P — a P with a
 * star in its bowl, carved into the head. Nothing in the model frames a
 * picture, so a disc dropped on top only ever covers PART of a letter, and the
 * strokes left showing around it are exactly what made the avatar read as a
 * sticker. `plate` below is the answer: fill the carving back in with the pin's
 * own clay, then cut a window into the flat head we just made.
 *
 * MEASURED, AND DIFFERENT PER VIEW. One shared pair of constants used to serve
 * both cameras on the theory that the pin's local box normalises them away. It
 * does not: the carving centres on (0.527, 0.408) dead-on but (0.462, 0.444)
 * angled. The old single centre of (0.500, 0.335) sat ~13px high on both at
 * 256px, so the P's descender stayed visible below the face on every pin.
 *
 * `tilt` is the angled view's extra rotation — the carving's principal axis
 * turns 7.5° between the two renders — and `squash` is the narrowing a round
 * window takes when the ball holding it is yawed away from the camera. Without
 * them the window sits bolt upright on a pin that is leaning.
 */
interface PinWindow {
  /** Centre, of the pin's alpha-box width and height. */
  cx: number
  cy: number
  /** Aperture radius, of the pin's width. */
  radius: number
  /** Clay patch that buries the carving, of the pin's width. Must exceed the
   *  carving's own reach from `cx,cy` — 0.316 dead-on, 0.314 angled. */
  plate: number
  /** Horizontal scale of the aperture, for a circle seen off-axis. */
  squash: number
  /** Rotation of aperture and bezel, radians. */
  tilt: number
}

const WINDOW: Record<'2d' | '3d', PinWindow> = {
  '2d': { cx: 0.527, cy: 0.408, radius: 0.280, plate: 0.330, squash: 1, tilt: 0 },
  '3d': { cx: 0.462, cy: 0.444, radius: 0.280, plate: 0.330, squash: 0.95, tilt: -7.5 * Math.PI / 180 },
}

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

// Composited sprites, newest-used last. BOUNDED: each entry is a 256px PNG
// data URI (~30-45KB of string that the JS heap holds, not a texture the GPU
// can evict), and the board is now the whole world — one composite per holder
// per colour, which on a long session with the colour wheel is unbounded
// growth for faces nobody is looking at any more. 48 covers every pin a
// screenful can show several times over; past that the coldest goes.
const composed = new Map<string, Promise<string>>()
const COMPOSED_MAX = 48

function touch(key: string, job: Promise<string>): void {
  // Map preserves insertion order, so delete+set moves a key to the newest
  // end and the FIRST key is always the least recently used.
  composed.delete(key)
  composed.set(key, job)
  while (composed.size > COMPOSED_MAX) {
    const oldest = composed.keys().next().value
    if (oldest === undefined) break
    composed.delete(oldest)
  }
}

/** How many composites are held — read by the headless fps/thermal drives to
 *  prove the cache stays bounded while the globe is panned. */
export function composedSpriteCount(): number {
  return composed.size
}

export interface PinFace {
  /** Profile picture: a bundled still, or the owner's own data URI. */
  avatar: string | null
  /** The pop's takeover colour — the rim around the face ties the pin to the
   *  ground it holds, which is how you read two overlapping claims apart. */
  color: string
  /** The poster's chosen pin model colour; null keeps the original pink pin. */
  pinColor?: PinColorId | null
  mode: '2d' | '3d'
}

/**
 * A pin sprite with `face.avatar` set into its head, as a data URI.
 *
 * Cached by (mode, avatar, colour): the map draws one marker per pop and a
 * screenful of pops from the same person is one composite, not thirty.
 */
export function pinWithFace(face: PinFace): Promise<string> {
  const key = `${face.mode}|${face.avatar ?? 'none'}|${face.color}|${face.pinColor ?? 'pink'}`
  const job = composed.get(key) ?? compose(face).catch(() => pinSprite(face.mode, face.pinColor ?? null))
  touch(key, job)
  return job
}

async function compose(face: PinFace): Promise<string> {
  const size = PIN_SPRITE_SIZE
  const base = await pinSprite(face.mode, face.pinColor ?? null)
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
    // The sprite is 256px but the marker renders it at 64 (60 flat), so the
    // outline is quartered on its way to the screen: the old 0.035 rim landed
    // as barely one pixel and the pin dissolved into pink terrain it happens to
    // match. 0.075 arrives as ~2.5px, which is what reads as an outline.
    const rim = Math.max(6, Math.round(box.w * 0.075))
    // Sixteen offsets around a circle, not eight around a square. At the old
    // width the difference did not show, but a diagonal offset reaches rim*√2
    // while an axial one reaches rim, so at this thickness an 8-way spread
    // gives a visibly lumpy, star-shaped edge.
    const RING_STEPS = 16
    for (let i = 0; i < RING_STEPS; i += 1) {
      const angle = (i / RING_STEPS) * Math.PI * 2
      ctx.drawImage(silhouette, Math.cos(angle) * rim, Math.sin(angle) * rim)
    }
    // A thin top-left key light is the clay shader's bright edge; the dark
    // silhouette still remains visible on every other side over pink terrain.
    silhouetteCtx.globalCompositeOperation = 'source-in'
    silhouetteCtx.fillStyle = 'rgba(255, 238, 249, 0.9)'
    silhouetteCtx.fillRect(0, 0, size, size)
    // A FRACTION of the old rim, not of the new one. This offset is a key
    // light catching the top-left edge, so it wants to stay a thin line at any
    // outline width; carrying the old 0.45 over to the thicker rim turned it
    // into a white crescent lying across the pin's shoulder.
    const keyLight = Math.max(2, Math.round(rim * 0.22))
    ctx.drawImage(silhouette, -keyLight, -keyLight)
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
  const geom = WINDOW[face.mode]
  const cx = box.x + box.w * geom.cx
  const cy = box.y + box.h * geom.cy
  const r = box.w * geom.radius

  // No avatar yet (nobody has set a picture): leave the pin as the artist drew
  // it, embossed P and all. Burying the carving for a picture that is not
  // coming would just leave a blank clay head, and inventing a placeholder face
  // is not ours to do.
  if (!face.avatar) return canvas.toDataURL('image/png')

  const avatar = await loadImage(face.avatar)

  // ── 1. Bury the carving ────────────────────────────────────────────────────
  // Scale the pin down to 8px and back up. That is a blur wide enough to
  // dissolve a 72px letter while keeping the ball's own light-to-dark falloff,
  // and unlike ctx.filter it needs no canvas-filter support to do it. Masked
  // twice: to the plate, so only the head is touched, and to the pin's own
  // alpha, so clay never bleeds past the silhouette we just outlined.
  const plateRadius = box.w * geom.plate
  const patch = document.createElement('canvas')
  patch.width = size
  patch.height = size
  const patchCtx = patch.getContext('2d')
  const tiny = document.createElement('canvas')
  tiny.width = 8
  tiny.height = 8
  const tinyCtx = tiny.getContext('2d')
  if (patchCtx && tinyCtx) {
    tinyCtx.drawImage(pin, 0, 0, 8, 8)
    patchCtx.drawImage(tiny, 0, 0, size, size)
    patchCtx.globalCompositeOperation = 'destination-in'
    patchCtx.beginPath()
    patchCtx.arc(cx, cy, plateRadius, 0, Math.PI * 2)
    patchCtx.fill()
    patchCtx.drawImage(pin, 0, 0, size, size)
    ctx.drawImage(patch, 0, 0)
  }

  // ── 2. Cut the window ──────────────────────────────────────────────────────
  // One transform for the aperture, the picture and the bezel, so all three
  // share the ball's lean instead of being three shapes that disagree about
  // which way the pin is facing.
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(geom.tilt)
  ctx.scale(geom.squash, 1)

  ctx.save()
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()
  // Cover-fit the (usually square) avatar into the circle without distorting.
  const scale = Math.max((r * 2) / avatar.width, (r * 2) / avatar.height)
  const dw = avatar.width * scale
  const dh = avatar.height * scale
  ctx.drawImage(avatar, -dw / 2, -dh / 2, dw, dh)

  // An aperture is a HOLE, so its near lip shadows the picture's top-left and
  // the far wall catches the light — the inverse of the raised-boss gradient on
  // the pin body. This is the cue that puts the picture inside the pin.
  const wall = ctx.createLinearGradient(-r, -r, r, r)
  wall.addColorStop(0, 'rgba(18, 0, 13, 0.5)')
  wall.addColorStop(0.45, 'rgba(18, 0, 13, 0.05)')
  wall.addColorStop(1, 'rgba(255, 240, 250, 0.15)')
  ctx.fillStyle = wall
  ctx.fillRect(-r, -r, r * 2, r * 2)
  // Seat the whole rim, or the corners of that square gradient read as a boxy
  // shadow sitting inside a round hole.
  const seat = ctx.createRadialGradient(0, 0, r * 0.58, 0, 0, r)
  seat.addColorStop(0, 'rgba(0, 0, 0, 0)')
  seat.addColorStop(1, 'rgba(0, 0, 0, 0.5)')
  ctx.fillStyle = seat
  ctx.fillRect(-r, -r, r * 2, r * 2)
  ctx.restore()

  // ── 3. The bezel ───────────────────────────────────────────────────────────
  // Dark keyline outermost so the aperture holds against clay AND against a
  // bright photo; the owner's colour just inside it, which is how overlapping
  // claims are told apart; a short highlight on the top lip, lit from the same
  // top-left as the outline.
  ctx.beginPath()
  ctx.arc(0, 0, r * 1.07, 0, Math.PI * 2)
  ctx.lineWidth = Math.max(4, r * 0.16)
  ctx.strokeStyle = 'rgba(35, 5, 28, 0.95)'
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(0, 0, r * 0.985, 0, Math.PI * 2)
  ctx.lineWidth = Math.max(3, r * 0.15)
  ctx.strokeStyle = face.color
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(0, 0, r * 1.12, Math.PI * 1.08, Math.PI * 1.72)
  ctx.lineWidth = Math.max(2, r * 0.05)
  ctx.strokeStyle = 'rgba(255, 245, 251, 0.92)'
  ctx.stroke()
  ctx.restore()

  return canvas.toDataURL('image/png')
}

/** Warm both tiers so the first pins do not pop in a frame late. */
export function warmPinSprites(): void {
  void pinSprite('3d').catch(() => {})
  void pinSprite('2d').catch(() => {})
}
