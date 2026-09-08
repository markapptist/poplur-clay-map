#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ids = ['big-ben', 'burj-khalifa', 'christ-redeemer', 'cn-tower', 'rogers-centre', 'colosseum', 'eiffel',
  'giza', 'golden-gate', 'space-needle', 'statue-liberty', 'sydney-opera', 'taj-mahal']
const hash = path => createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')
const renderer = 'scripts/render-meshy-gamepiece-review.py'
mkdirSync(resolve(root, 'public/sprites/conquer-landmarks'), { recursive: true })
const icons = {}
for (const id of ids) {
  const glb = `landmarks/${id}.glb`
  const image = `sprites/conquer-landmarks/${id}-s320.png`
  const result = spawnSync(process.env.POPLUR_BLENDER || 'blender', ['--background', '--python', renderer,
    '--', `public/${glb}`, `public/${image}`, '--size', '320', '--yaw', '38', '--pitch', '18'],
  { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) throw Error(`${id}: ${result.stderr}\n${result.stdout}`)
  icons[id] = { glb, glbSha256: hash(`public/${glb}`), image, imageSha256: hash(`public/${image}`) }
  console.log(`Baked ${id}`)
}
writeFileSync(resolve(root, 'src/conquerLandmarkManifest.json'), JSON.stringify({
  renderer, size: 320, yaw: 38, pitch: 18, icons,
}, null, 2) + '\n')
