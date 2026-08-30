#!/usr/bin/env node

/**
 * Bake the far-world Map icons directly from the shipping landmark GLBs.
 *
 * Usage:
 *   node scripts/generate-world-landmark-icons.mjs
 *
 * POPLUR_BLENDER may point at a non-default Blender executable. The shared
 * renderer grounds, frames and lights each model deterministically; this
 * wrapper records both source and output hashes so tests fail if either side
 * is replaced without regenerating the other.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BLENDER = process.env.POPLUR_BLENDER || 'blender'
const RENDERER = 'scripts/render-meshy-gamepiece-review.py'
const OUTPUT_DIR = 'public/sprites/world-landmarks'
const MANIFEST = 'src/worldLandmarkIconManifest.json'
const SIZE = 96
const YAW = 38
const PITCH = 18

const IDS = [
  'big-ben',
  'burj-khalifa',
  'christ-redeemer',
  'cn-tower',
  'colosseum',
  'eiffel',
  'giza',
  'golden-gate',
  'space-needle',
  'statue-liberty',
  'sydney-opera',
  'taj-mahal',
]

function sha256(path) {
  return createHash('sha256').update(readFileSync(resolve(ROOT, path))).digest('hex')
}

mkdirSync(resolve(ROOT, OUTPUT_DIR), { recursive: true })

const icons = {}
for (const id of IDS) {
  const glb = `public/landmarks/${id}.glb`
  const sprite = `${OUTPUT_DIR}/${id}-glb-s${SIZE}.png`
  const run = spawnSync(BLENDER, [
    '--background',
    '--python', RENDERER,
    '--', glb, sprite,
    '--size', String(SIZE),
    '--yaw', String(YAW),
    '--pitch', String(PITCH),
  ], { cwd: ROOT, stdio: 'inherit' })
  if (run.error) throw run.error
  if (run.status !== 0) throw new Error(`Blender failed for ${id} (exit ${run.status})`)

  icons[id] = {
    glb: glb.replace(/^public\//, ''),
    glbSha256: sha256(glb),
    sprite: sprite.replace(/^public\//, ''),
    spriteSha256: sha256(sprite),
  }
}

writeFileSync(resolve(ROOT, MANIFEST), `${JSON.stringify({
  schemaVersion: 1,
  renderer: RENDERER,
  render: { size: SIZE, yaw: YAW, pitch: PITCH },
  icons,
}, null, 2)}\n`)

console.log(`Baked ${IDS.length} exact-GLB world icons and wrote ${MANIFEST}.`)
