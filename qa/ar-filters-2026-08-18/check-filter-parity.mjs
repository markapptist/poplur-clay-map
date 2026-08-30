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
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// The rail's ids moved OUT of ARFilters.tsx and into the streamed catalog when
// filters stopped being compiled in. This guard kept regexing the .tsx, found
// zero ids, and reported PASS on an empty set — the exact silent-failure shape
// it was written to catch. It reads the catalog now, and refuses to pass on an
// empty parse.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const WEB = resolve(root, 'src/arFilterCatalog.json')
const CAMERA = resolve(root, 'src/Camera.tsx')
const iosRoot = process.env.POPLUR_IOS_ROOT ?? '/Users/matrix/Developer/Poplur2025-iOS'
const IOS = resolve(iosRoot, 'Poplur2025/ARFilterManager.swift')
const CAMERA_LAYER = resolve(iosRoot, 'Poplur2025/WebHomeCameraLayer.swift')
const CAMERA_CONTROLLER = resolve(iosRoot, 'Poplur2025/CameraKitController.swift')

const ios = readFileSync(IOS, 'utf8')
const cameraLayer = readFileSync(CAMERA_LAYER, 'utf8')
const cameraController = readFileSync(CAMERA_CONTROLLER, 'utf8')
const camera = readFileSync(CAMERA, 'utf8')

const catalog = JSON.parse(readFileSync(WEB, 'utf8'))
const webIDs = catalog.filters.map(f => f.id)
if (webIDs.length === 0) {
  console.error('FAIL  the catalog parsed to zero filters — this guard cannot verify anything')
  process.exit(1)
}
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
// The grade lookup became `currentGrade(for:)` when filters started streaming
// (it prefers a recipe sent with the pick over the compiled table). The
// property being guarded is unchanged: the grade must be applied BEFORE any
// face-observation guard, or fourteen whole-frame filters do nothing unless a
// face happens to be in shot.
const GRADE_CALL = 'if let grade = currentGrade(for: activeFilter)'
check('the grade applies without a detected face',
  new RegExp(`${GRADE_CALL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{[\\s\\S]{0,160}?return applyGrade`).test(ios)
  && ios.indexOf(GRADE_CALL) < ios.indexOf('guard let faceObservation'))

// A filter published after this binary shipped must still render. Without a
// case that survives an unknown rawValue, the streamed recipe arrives and both
// render entry points discard the frame on `.none` before consulting it.
check('an unknown streamed id can still render',
  ios.includes('case streamed = "__streamed"'))

// Vision owns the full landmark mesh. The transparent web overlay must receive
// the eye/nose centres from that SAME pass instead of running a second detector
// or guessing every accessory from the face rectangle.
check('Vision eye and nose landmarks reach the web AR overlay',
  ios.includes('struct FaceLandmarkTrack')
  && /onFaceTrack\?\([\s\S]*observation\.map\(faceLandmarks\)/.test(ios)
  && cameraLayer.includes('landmarks: ARFilterManager.FaceLandmarkTrack?')
  && cameraLayer.includes('facePayload["landmarks"] = landmarkPayload'))

// iOS stills bypass the filtered preview-frame lane, while Android's native
// shutter sends a raw still back to the WebView. Both paths must bake the same
// selected grade before the shared composer opens.
check('iOS still captures bake the selected AR grade',
  ios.includes('func applyActiveGrade(to image: CIImage)')
  && cameraController.includes('applyingActiveARGrade(to: image)'))
check('Android native stills bake the selected catalog grade',
  camera.includes('const webGradeCss = ANDROID_SHELL')
  && camera.includes('if (webGradeCss) context.filter = webGradeCss')
  && camera.includes('if (anaglyphPx > 0) applyAnaglyphToCanvas(context, anaglyphPx)'))
check('browser stills retain the selected grade and AR costume',
  camera.includes("if (filterCss !== 'none') ctx.filter = filterCss")
  && camera.includes('drawFaceAREffect(ctx, canvas.width, canvas.height, detections, arFilter'))

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
