// The AR rail's ids are a WIRE FORMAT shared with iOS. When the rail was
// rebuilt from the filter sheet its fifteen ids replaced the original nine and
// nothing downstream learned them — WebHomeCameraLayer resolves the web id
// against ARFilter.rawValue, so `none`/`None` was the only pair that matched
// and every real selection resolved to .none. Nothing failed loudly; the rail
// simply did nothing on a device.
//
// This is the cheap guard against that whole bug class: every id the rail can
// send must exist natively, and every grade must be translated.
import { readFileSync } from 'node:fs'
const WEB = '/Users/matrix/Developer/poplur-clay-map/src/ARFilters.tsx'
const IOS = '/Users/matrix/Developer/Poplur2025-iOS/Poplur2025/ARFilterManager.swift'

const web = readFileSync(WEB, 'utf8')
const ios = readFileSync(IOS, 'utf8')

const webIDs = [...web.matchAll(/\{ id: '([a-z0-9-]+)'/g)].map(m => m[1])
const iosRaw = [...ios.matchAll(/^\s+case [a-zA-Z0-9]+ = "([^"]+)"/gm)].map(m => m[1])
// Which ids the Core Image translation actually covers.
const graded = [...ios.matchAll(/case \.web[A-Za-z0-9]+:\s+return Grade\(/g)].length

let failures = 0
const check = (n, ok, d = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `  — ${d}` : ''}`) }

console.log(`web rail: ${webIDs.length} ids · native enum: ${iosRaw.length} raw values\n`)

const lower = iosRaw.map(v => v.toLowerCase())
const missing = webIDs.filter(id => !lower.includes(id.toLowerCase()))
check('every rail id resolves to a native ARFilter case', missing.length === 0,
  missing.length ? `unmatched: ${missing.join(', ')}` : `all ${webIDs.length} match`)

// 'none' is the pass-through and carries no grade; the other fourteen do.
check('every non-none rail id has a Core Image grade', graded === webIDs.length - 1,
  `${graded} grades for ${webIDs.length - 1} filters`)

check('the native pickers still list only the nine with bundled artwork',
  /availableFilters: \[ARFilter\] = ARFilter\.nativePickerFilters/.test(ios)
  && !/availableFilters: \[ARFilter\] = ARFilter\.allCases/.test(ios))

// The grade must not be gated on a face: most of these grade the whole picture.
check('the grade applies without a detected face',
  /if let grade = activeFilter\.grade \{[\s\S]{0,160}?return applyGrade/.test(ios)
  && ios.indexOf('if let grade = activeFilter.grade') < ios.indexOf('guard let faceObservation'))

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
