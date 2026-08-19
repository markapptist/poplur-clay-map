#!/usr/bin/env node
/**
 * Turn directories under public/ into publishable asset packs.
 *
 * Produces dist-packs/<pack-id>/… plus a manifest the app ships. Nothing is
 * uploaded here: publishing is a separate, deliberate step, because it is the
 * one action that changes what every installed copy of the app fetches.
 */

import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const PUBLIC = 'public'
const OUT = 'dist-packs'

/**
 * What moves out of the bundle. Chosen by weight and by whether a player who
 * never opens the screen should have paid to download it.
 */
const PACKS = [
  { id: 'arcade-art',     from: 'games/arcade/art',  version: 1 },
  { id: 'subscreens',     from: 'subscreens',        version: 1 },
  { id: 'profile-themes', from: 'profile-themes',    version: 1 },
]

const walk = (dir, base = dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = join(dir, e.name)
    return e.isDirectory() ? walk(full, base) : [relative(base, full)]
  })

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const packs = []
for (const pack of PACKS) {
  const src = join(PUBLIC, pack.from)
  let files
  try { files = walk(src) } catch { console.error(`  skipped ${pack.id}: ${src} not found`); continue }

  const dest = join(OUT, pack.id)
  cpSync(src, dest, { recursive: true })

  const bytes = files.reduce((sum, f) => sum + statSync(join(src, f)).size, 0)
  // A digest of the file list and sizes, so a changed pack is visible without
  // hashing every byte of a 66MB directory on every build.
  const digest = createHash('sha256')
    .update(files.map(f => `${f}:${statSync(join(src, f)).size}`).sort().join('\n'))
    .digest('hex').slice(0, 12)

  packs.push({ id: pack.id, version: pack.version, bytes, digest, files })
  console.error(`  ${pack.id.padEnd(16)} ${files.length} files, ${(bytes / 1048576).toFixed(1)}MB  ${digest}`)
}

/**
 * Where the app fetches packs from.
 *
 * Defaults to the copies still sitting in public/, so the app keeps working
 * before anything is uploaded. Publishing flips it to the bucket:
 *   POPLUR_PACK_BASE=bucket node scripts/build-asset-packs.mjs
 *
 * Plain storage.googleapis.com URLs rather than the firebasestorage form,
 * which percent-encodes every slash and would make path joining a special case.
 */
// A SEPARATE bucket, not the app's default one. The default bucket holds user
// uploads — profile pictures and selfie videos — and making it publicly
// readable to serve game art would expose every one of them. Packs contain
// nothing user-generated, so a dedicated public bucket is safe and keeps the
// two blast radii apart.
const BUCKET = 'https://storage.googleapis.com/poplur2025-assets/asset-packs'
const LOCAL = { 'arcade-art': 'games/arcade/art', subscreens: 'subscreens', 'profile-themes': 'profile-themes' }
const useBucket = process.env.POPLUR_PACK_BASE === 'bucket'

const manifest = {
  baseUrl: useBucket ? BUCKET : '',
  // Local mode serves each pack from where it already lives in public/, so
  // nothing has to move before the upload happens.
  localPaths: useBucket ? undefined : LOCAL,
  packs,
}
writeFileSync(join(PUBLIC, 'asset-manifest.json'), JSON.stringify(manifest, null, 2))
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))

const total = packs.reduce((s, p) => s + p.bytes, 0)
console.error(`\nmanifest written. ${(total / 1048576).toFixed(0)}MB moves out of the bundle.`)
console.error(`publish with:  npm run publish-packs`)
