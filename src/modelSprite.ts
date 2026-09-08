import PRERENDERED from './spritePrerender.json'
import { poplurAssetCache } from './PoplurAssetCache'

// Renders a provided clay GLB once to a transparent PNG data-URL so Mapbox
// markers can wear the real 3D model (globe projection has no custom-layer
// support, so sprites are the portable way to put these models on the map).
//
// PERFORMANCE — read before adding a sprite:
// The output of this module is deterministic: the same GLB at the same camera
// angle produces byte-identical pixels every run. Producing it at RUNTIME meant
// the map downloaded and Draco-decoded ~113MB of geometry on every launch just
// to make a handful of 256px pictures (car.glb alone is 32MB for one sprite).
// Measured on the map at 6x CPU throttle, that was ~40% of all main-thread
// samples — GLTFLoader, Blob, stream read/enqueue/close, createObjectURL —
// against ~3% for Mapbox itself. It was the single biggest cost on the screen.
//
// So the sprites are now pre-rendered at build time (.codex/prerender-sprites.mjs
// writes public/sprites/ + spritePrerender.json) and the GLB is never fetched on
// a user's device. The runtime path below is kept as the fallback for any view
// that has not been pre-rendered yet — it still works, it is just slow, so a
// missing entry warns in dev rather than silently costing 32MB.

const inflightSprites = new Map<string, Promise<string>>()

const manifest = PRERENDERED as Record<string, string>
const PRODUCTION_SPRITE_SOURCES = new Set([
  'models/boat.glb',
  'models/car.glb',
  'models/plane.glb',
  'models/poplur_mic.glb',
  'models/poplur_mixer.glb',
  'models/poplur_pin.glb',
  'zoom_airplane.glb',
  'zoom_buildings.glb',
  'zoom_globe.glb',
  'poplur_camera_kodak.glb',
  'poplur_dice_lite.glb',
  'poplur_mark_head_navigator.glb',
  // The zoom rail's radius trophies (radiusTrophies.ts). Baked once; the
  // models never ship.
  'models/poplur_trophy_bronze.glb',
  'models/poplur_trophy_silver.glb',
  'models/poplur_trophy_gold.glb',
  'models/poplur_trophy_platinum.glb',
  'models/poplur_trophy_diamond.glb',
])

export interface SpriteView {
  /** camera yaw around the model, degrees */
  yaw?: number
  /** camera elevation, degrees — 90 looks straight down (top view) */
  pitch?: number
  /** output square size in px */
  size?: number
}

function viewKey(url: string, view: SpriteView): string {
  return `${url}|${view.yaw ?? 0}|${view.pitch ?? 15}|${view.size ?? 320}`
}

export function modelSprite(url: string, view: SpriteView = {}): Promise<string> {
  const key = viewKey(url, view)

  // Pre-rendered: a plain image URL, no GLB, no decode, no WebGL.
  const ready = manifest[key]
  if (ready) return Promise.resolve(ready)

  // These multi-megabyte GLBs are authoring inputs for the sprite pass, not
  // runtime assets. Production builds deliberately omit them. Fail closed if
  // a new view was not baked, rather than silently downloading/decoding up to
  // 44 MB and opening another WebGL context on a phone. Development keeps the
  // fallback below so the missing view can be captured and added to manifest.
  if (import.meta.env.PROD && PRODUCTION_SPRITE_SOURCES.has(url)) {
    return Promise.reject(new Error(`Missing pre-rendered production sprite: ${key}`))
  }

  const cached = poplurAssetCache.get<string>(`sprite:${key}`)
  if (cached) return Promise.resolve(cached)

  let promise = inflightSprites.get(key)
  if (!promise) {
    if (import.meta.env.DEV) {
      console.warn(
        `[modelSprite] no pre-rendered sprite for "${key}" — falling back to a ` +
        `runtime GLB decode. Re-run .codex/prerender-sprites.mjs to add it.`,
      )
    }
    requested.add(key)
    promise = import('./runtimeModelSprite').then(runtime => runtime.renderModelSprite(url, view))
      .then(sprite => {
        // A base64 character represents six bits; this is a conservative
        // decoded-string estimate, not a claim about process memory.
        poplurAssetCache.set(`sprite:${key}`, sprite, {
          kind: 'decoded-image',
          estimatedBytes: Math.ceil(sprite.length * 1.5),
        })
        return sprite
      })
      .finally(() => inflightSprites.delete(key))
    inflightSprites.set(key, promise)
  }
  return promise
}

/** Every sprite the app asks for, so the pre-render pass knows what to bake. */
export function recordedSpriteKeys(): string[] {
  return [...requested]
}
const requested = new Set<string>()
