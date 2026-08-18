#!/usr/bin/env node
// Guardrail: continuous work must go through the frame governor.
//
// The 17 Aug thermal audit found the heat was never the visuals — it was work
// nobody demanded: rAF loops that re-armed forever, sub-second intervals with
// their own wake schedules, and WebGL contexts nothing could pause. Those are
// cheap to add and invisible in review, so this runs in `npm run build`, which
// means sync-mobile runs it before every publish.
//
// It is a RATCHET, not a cleanup mandate: the committed baseline records what
// each file has today, and the build fails only when a file grows a NEW one.
// Removing work always passes, and lowering the baseline is encouraged.
//
//   npm run check:governed-loops -- --update    (re-baseline, deliberately)
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const BASELINE = join(dirname(fileURLToPath(import.meta.url)), 'governed-loops-baseline.json')
const UPDATE = process.argv.includes('--update')

// What counts as ungoverned continuous work. Deliberately syntactic: a real
// parser would be better, but this has to stay dependency-free to run inside
// the release path.
const RULES = [
  {
    key: 'rawRaf',
    label: 'raw requestAnimationFrame (use onFrame from frameGovernor)',
    // The governor owns exactly one rAF driver; everything else should
    // subscribe to it so the clock can sleep when no subscriber is dirty.
    test: line => /requestAnimationFrame\s*\(/.test(line),
  },
  {
    key: 'shortInterval',
    label: 'setInterval under 1s (use onTick so wakes coalesce)',
    test: line => {
      const m = line.match(/setInterval\s*\([^,]*,\s*([0-9_]+)\s*\)/)
      if (!m) return false
      return Number(m[1].replace(/_/g, '')) < 1000
    },
  },
  {
    key: 'webglRenderer',
    label: 'new WebGLRenderer (must registerRenderer so it holds a lease)',
    test: line => /new\s+THREE\.WebGLRenderer|new\s+WebGLRenderer/.test(line),
  },
]

function walk(dir) {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return walk(full)
    return /\.(ts|tsx)$/.test(full) ? [full] : []
  })
}

const counts = {}
for (const file of walk(SRC)) {
  const rel = relative(SRC, file)
  const lines = readFileSync(file, 'utf8').split('\n')
  for (const rule of RULES) {
    // An explicit opt-out, so a justified exception is a visible decision in
    // the diff rather than a silently rising number.
    const n = lines.filter((l, i) =>
      rule.test(l) && !/governor-ok/.test(l) && !/governor-ok/.test(lines[i - 1] ?? '')).length
    if (n > 0) (counts[rel] ??= {})[rule.key] = n
  }
}

if (UPDATE) {
  writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + '\n')
  console.error(`governed-loops: baseline rewritten (${Object.keys(counts).length} files)`)
  process.exit(0)
}

let baseline = {}
try {
  baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
} catch {
  writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + '\n')
  console.error('governed-loops: no baseline found — wrote the current state as the starting point.')
  process.exit(0)
}

const regressions = []
const improvements = []
for (const [file, rules] of Object.entries(counts)) {
  for (const [key, n] of Object.entries(rules)) {
    const was = baseline[file]?.[key] ?? 0
    if (n > was) regressions.push({ file, key, was, now: n })
  }
}
for (const [file, rules] of Object.entries(baseline)) {
  for (const [key, was] of Object.entries(rules)) {
    const now = counts[file]?.[key] ?? 0
    if (now < was) improvements.push({ file, key, was, now })
  }
}

if (improvements.length) {
  console.error(`governed-loops: ${improvements.length} improvement(s) — re-baseline with --update to lock them in:`)
  for (const i of improvements.slice(0, 5)) console.error(`   · ${i.file} ${i.key}: ${i.was} → ${i.now}`)
}

if (regressions.length) {
  console.error('\n🔥 GOVERNED-LOOPS CHECK FAILED — new ungoverned continuous work:\n')
  for (const r of regressions) {
    const rule = RULES.find(x => x.key === r.key)
    console.error(`   · ${r.file}: ${r.was} → ${r.now}  ${rule.label}`)
  }
  console.error(`
Every one of these keeps the CPU or GPU awake when nothing has changed, which is
what the thermal audit found heating the phone — not the visuals.

Fix it (subscribe to onFrame/onTick, or registerRenderer), or if this instance is
genuinely justified, mark the line with a \`governor-ok\` comment explaining why
and re-run. Blanket re-baselining with --update defeats the point.
`)
  process.exit(1)
}
console.error('governed-loops: OK — no new ungoverned loops, intervals, or renderers.')
