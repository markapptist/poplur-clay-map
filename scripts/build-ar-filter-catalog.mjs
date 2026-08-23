/**
 * Build the AR filter catalog — the streamed source of truth for filters.
 *
 * Filters used to be defined twice in code: a CSS chain in src/ARFilters.tsx
 * and a Core Image Grade in the iOS ARFilterManager. Adding one meant editing
 * both and shipping two app builds, which is exactly the wrong shape for a
 * library the user intends to keep growing. This lifts BOTH definitions into
 * one JSON catalog that ships from Cloud Storage like every other pack, so a
 * new filter is a catalog entry plus a thumbnail — no app release.
 *
 * SEEDING IS DONE. This parsed both shipping sources so the first catalog was
 * provably identical to what was already on devices; ARFilters.tsx no longer
 * holds ids, so that path cannot run again and does not need to.
 *
 * What remains is the drift that outlives the migration: the catalog's grades
 * and iOS's compiled fallback table must agree. They are two copies of the
 * same numbers, and a phone falls back to the Swift table whenever a pick
 * arrives without a streamed grade — so a silent divergence means a filter
 * that looks one way in the browser and another on the device.
 *
 *   node scripts/build-ar-filter-catalog.mjs --check   # exit 1 on drift
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const IOS = '/Users/matrix/Developer/Poplur2025-iOS/Poplur2025/ARFilterManager.swift'
const checkOnly = process.argv.includes('--check')

// ── the catalog is the source ────────────────────────────────────────────────
const catalogPath = resolve(root, 'src/arFilterCatalog.json')
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))

// ── native: rawValue -> Grade(...) ───────────────────────────────────────────
const ios = readFileSync(IOS, 'utf8')
const caseToId = {}
for (const m of ios.matchAll(/case\s+(web[A-Za-z0-9]+)\s*=\s*"([^"]+)"/g)) caseToId[m[1]] = m[2]
const grades = {}
for (const m of ios.matchAll(/case\s+\.(web[A-Za-z0-9]+):\s*return\s+Grade\(([^)]*)\)/g)) {
  const id = caseToId[m[1]]
  if (!id) continue
  const g = {}
  for (const part of m[2].split(',')) {
    const kv = part.split(':').map(s => s.trim())
    if (kv.length === 2 && kv[1] !== '') g[kv[0]] = Number(kv[1])
  }
  grades[id] = g
}

if (Object.keys(grades).length === 0) {
  console.error('FAIL  parsed zero grades from ARFilterManager.swift — this check cannot verify anything')
  process.exit(1)
}

let drift = 0
for (const f of catalog.filters) {
  if (f.id === 'none') continue
  const native = grades[f.id]
  if (!native) {
    // Not drift: a filter published after the last release has no native case,
    // which is exactly what the streamed grade exists to cover.
    continue
  }
  const mine = f.grade ?? {}
  const keys = [...new Set([...Object.keys(mine), ...Object.keys(native)])]
  for (const k of keys) {
    if ((mine[k] ?? 0) !== (native[k] ?? 0)) {
      console.error(`DRIFT  ${f.id}.${k}: catalog ${mine[k] ?? 0} vs native ${native[k] ?? 0}`)
      drift++
    }
  }
}

const compared = catalog.filters.filter(f => f.id !== 'none' && grades[f.id]).length
if (drift) {
  console.error(`\n${drift} grade value(s) drifted across ${compared} filters`)
  process.exit(1)
}
console.log(`ar-filter catalog: ${catalog.filters.length} filters, ${compared} grades match native exactly`)
