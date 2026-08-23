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
 * This generator exists so the first catalog is provably identical to what
 * already ships: it PARSES the two current sources rather than transcribing
 * them by hand. Run it once to seed the catalog; after that the catalog is the
 * source and this is only a re-verification tool.
 *
 *   node scripts/build-ar-filter-catalog.mjs           # write + verify
 *   node scripts/build-ar-filter-catalog.mjs --check   # verify only, exit 1 on drift
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const IOS = '/Users/matrix/Developer/Poplur2025-iOS/Poplur2025/ARFilterManager.swift'
const checkOnly = process.argv.includes('--check')

// ── web: id / label / css / thumbnail ────────────────────────────────────────
const web = readFileSync(resolve(root, 'src/ARFilters.tsx'), 'utf8')
const arrayBody = web.slice(
  web.indexOf('export const AR_FILTERS'),
  web.indexOf('\n]', web.indexOf('export const AR_FILTERS')),
)
const webFilters = []
const entryRe = /\{\s*id:\s*'([^']+)',\s*label:\s*'([^']+)',\s*css:\s*'([^']*)',\s*thumbnail:\s*'([^']+)'\s*\}/g
for (const m of arrayBody.matchAll(entryRe)) {
  webFilters.push({ id: m[1], label: m[2], css: m[3], thumbnail: m[4] })
}
if (webFilters.length === 0) throw new Error('parsed zero filters from ARFilters.tsx')

// ── native: rawValue -> Grade(...) ───────────────────────────────────────────
const ios = readFileSync(IOS, 'utf8')
// enum case  ->  rawValue     e.g.  case webPop3D = "pop-3d"
const caseToId = {}
for (const m of ios.matchAll(/case\s+(web[A-Za-z0-9]+)\s*=\s*"([^"]+)"/g)) caseToId[m[1]] = m[2]
// grade table  e.g.  case .webPop3D: return Grade(saturation: 1.1, bloom: 0.2, anaglyph: 3)
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

// ── merge ────────────────────────────────────────────────────────────────────
const filters = webFilters.map(f => ({
  id: f.id,
  label: f.label,
  thumbnail: f.thumbnail,
  css: f.css,
  // Absent for `none`, which is the absence of a filter rather than a grade.
  ...(grades[f.id] ? { grade: grades[f.id] } : {}),
}))

const missingGrade = filters.filter(f => f.id !== 'none' && !f.grade).map(f => f.id)
const orphanGrade = Object.keys(grades).filter(id => !filters.some(f => f.id === id))

const catalog = {
  // Bumped when entries change; the app prefers the highest version it can reach.
  version: 1,
  filters,
}
const json = JSON.stringify(catalog, null, 2) + '\n'

const dest = resolve(root, 'src/arFilterCatalog.json')
const published = resolve(root, 'public/ar-filters/catalog.json')

if (checkOnly) {
  const current = readFileSync(dest, 'utf8')
  if (current !== json) {
    console.error('ar-filter catalog DRIFT: src/arFilterCatalog.json no longer matches the code it was seeded from')
    process.exit(1)
  }
  console.log(`ar-filter catalog: ${filters.length} filters, no drift`)
} else {
  writeFileSync(dest, json)
  writeFileSync(published, json)
  console.log(`ar-filter catalog: wrote ${filters.length} filters`)
}
if (missingGrade.length) console.warn(`  no native grade: ${missingGrade.join(', ')}`)
if (orphanGrade.length) console.warn(`  native-only grade: ${orphanGrade.join(', ')}`)
