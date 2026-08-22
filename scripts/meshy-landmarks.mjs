// Generate landmark models for the clay map through Meshy text-to-3D.
//
// The clay world extrudes Mapbox footprints to a height, so every landmark
// arrives as a featureless prism (see src/clayLandmarks.ts). This mints the
// real silhouettes. Text-to-3D rather than the app's image-to-3D proxy: there
// are no source photographs to feed it, and a landmark is a shape everybody
// already knows by name.
//
//   node scripts/meshy-landmarks.mjs preview   # 5 credits each, untextured
//   node scripts/meshy-landmarks.mjs status
//   node scripts/meshy-landmarks.mjs refine    # 10 credits each, textured
//   node scripts/meshy-landmarks.mjs download
//
// The key comes from the environment, never from a file in the repo:
//   MESHY_API_KEY=$(firebase functions:secrets:access MESHY_API_KEY)
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'

const KEY = process.env.MESHY_API_KEY?.trim()
if (!KEY) { console.error('MESHY_API_KEY is not set'); process.exit(1) }

const API = 'https://api.meshy.ai/openapi/v2/text-to-3d'
const STATE = 'scripts/.meshy-landmarks.json'
const OUT = 'scripts/.meshy-out'

/** The map's landmark POIs (App.tsx TOUR_DESTINATIONS, kind: 'landmark'),
 *  with the real height each model is scaled to in clayLandmarks.ts. */
const LANDMARKS = [
  { id: 'cn-tower', subject: 'the CN Tower in Toronto', heightM: 553 },
  { id: 'eiffel', subject: 'the Eiffel Tower in Paris', heightM: 330 },
  { id: 'big-ben', subject: 'the Big Ben clock tower in London', heightM: 96 },
  { id: 'giza', subject: 'the Giza Pyramids in Egypt', heightM: 139,
    // v2 came back as three soft cones: the house 'smooth rounded edges'
    // clause below fights a pyramid, which IS its edges. This overrides it
    // locally rather than weakening the shared clay read for the other eleven.
    shape: 'Three separate pyramids of descending size standing side by side. Each is strictly four-sided with a square base, four flat straight triangular faces, and sharp crisp edges meeting at a point. Hard angular geometry, faceted, NOT rounded, NOT conical, no smoothing', hardEdges: true },
  { id: 'christ-redeemer', subject: 'the Christ the Redeemer statue in Rio de Janeiro', heightM: 38,
    shape: 'A standing robed figure with both arms fully outstretched straight out to the sides, horizontal, so the whole silhouette forms a wide cross, on a rectangular pedestal' },
  { id: 'statue-liberty', subject: 'the Statue of Liberty in New York', heightM: 93 },
  { id: 'taj-mahal', subject: 'the Taj Mahal in Agra', heightM: 73 },
  { id: 'sydney-opera', subject: 'the Sydney Opera House', heightM: 65 },
  { id: 'colosseum', subject: 'the Colosseum in Rome', heightM: 48 },
  { id: 'burj-khalifa', subject: 'the Burj Khalifa tower in Dubai', heightM: 828 },
  { id: 'space-needle', subject: 'the Space Needle in Seattle', heightM: 184 },
  { id: 'golden-gate', subject: 'the Golden Gate Bridge in San Francisco', heightM: 227,
    shape: 'A long horizontal suspension bridge seen side on: two tall rectangular towers rising from the deck, a straight roadway spanning the full width, and draped suspension cables sweeping between the towers' },
]

/** Clay is the house look, and these sit in a clay world beside clay
 *  buildings — a photoreal tower would read as pasted in.
 *
 *  `shape` names the silhouette when the subject alone did not carry it. The
 *  first pass proved the model answers the NAME loosely and the DESCRIPTION
 *  exactly: 'the Golden Gate Bridge' came back as a tower rather than a span,
 *  and Christ the Redeemer came back with its arms down. Anything with a
 *  shape here is a re-preview of a rejected first attempt. */
const prompt = (subject, shape, hardEdges) =>
  `${subject}, as a small handmade polymer clay sculpture. ` +
  (shape ? `${shape}. ` : '') +
  `Soft matte clay ` +
  `material, ${hardEdges ? 'crisp defined edges and flat faces' : 'smooth rounded edges'}, simplified stylised forms, solid pastel ` +
  `colours, gentle studio lighting. The complete structure, standing upright ` +
  `and centred, seen from a normal eye-level angle. No ground plane, no base ` +
  `plate, no scenery, plain background.`

const api = async (path, init = {}) => {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...init.headers },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : {}
}

const readState = () => existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {}
const writeState = state => writeFileSync(STATE, JSON.stringify(state, null, 2))

async function balance() {
  const res = await fetch('https://api.meshy.ai/openapi/v1/balance', {
    headers: { Authorization: `Bearer ${KEY}` },
  })
  return (await res.json()).balance
}

async function preview() {
  const state = readState()
  console.log(`balance before: ${await balance()}`)
  // Naming ids re-previews exactly those, replacing a rejected first attempt:
  //   node scripts/meshy-landmarks.mjs preview golden-gate
  // The superseded task id is kept so a paid-for result is never simply lost.
  const wanted = process.argv.slice(3)
  for (const mark of LANDMARKS) {
    if (wanted.length && !wanted.includes(mark.id)) continue
    if (state[mark.id]?.previewTask && !wanted.length) { console.log(`${mark.id}: already has a preview task`); continue }
    const superseded = state[mark.id]?.previewTask
    const { result } = await api('', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'preview',
        prompt: prompt(mark.subject, mark.shape, mark.hardEdges),
        // 'realistic' is the only value the API still accepts, so the clay
        // read has to come from the prompt rather than from a style flag.
        art_style: 'realistic',
        should_remesh: true,
        topology: 'triangle',
        target_polycount: 30000,
      }),
    })
    state[mark.id] = {
      ...state[mark.id], ...mark, previewTask: result,
      ...(superseded ? { supersededPreviewTasks: [...(state[mark.id]?.supersededPreviewTasks ?? []), superseded] } : {}),
      // A replaced preview invalidates anything derived from the old one.
      previewGlb: undefined, refineTask: undefined, refineGlb: undefined,
    }
    writeState(state)
    console.log(`${mark.id}: preview task ${result}`)
  }
  console.log(`balance after: ${await balance()}`)
}

async function status() {
  const state = readState()
  mkdirSync(OUT, { recursive: true })
  let pending = 0
  for (const mark of Object.values(state)) {
    const task = mark.refineTask ?? mark.previewTask
    if (!task) continue
    const info = await api(`/${task}`)
    const stage = mark.refineTask ? 'refine' : 'preview'
    console.log(`${mark.id.padEnd(18)} ${stage.padEnd(8)} ${String(info.status).padEnd(10)} ${info.progress ?? 0}%`)
    if (info.status === 'SUCCEEDED') {
      mark[`${stage}Thumb`] = info.thumbnail_url
      mark[`${stage}Glb`] = info.model_urls?.glb
      writeState(state)
    } else if (info.status !== 'FAILED') pending++
  }
  console.log(pending ? `${pending} still running` : 'all tasks settled')
  return pending
}

async function refine() {
  const state = readState()
  console.log(`balance before: ${await balance()}`)
  // Only the ids passed on the command line, so a rejected preview is never
  // paid for twice: node scripts/meshy-landmarks.mjs refine cn-tower eiffel
  const wanted = process.argv.slice(3)
  for (const mark of Object.values(state)) {
    if (wanted.length && !wanted.includes(mark.id)) continue
    if (mark.refineTask) { console.log(`${mark.id}: already refined`); continue }
    if (!mark.previewTask) continue
    const { result } = await api('', {
      method: 'POST',
      body: JSON.stringify({ mode: 'refine', preview_task_id: mark.previewTask }),
    })
    mark.refineTask = result
    writeState(state)
    console.log(`${mark.id}: refine task ${result}`)
  }
  console.log(`balance after: ${await balance()}`)
}

async function download() {
  const state = readState()
  mkdirSync(OUT, { recursive: true })
  for (const mark of Object.values(state)) {
    for (const stage of ['preview', 'refine']) {
      const thumb = mark[`${stage}Thumb`]
      if (thumb && !existsSync(`${OUT}/${mark.id}-${stage}.png`)) {
        const buf = Buffer.from(await (await fetch(thumb)).arrayBuffer())
        writeFileSync(`${OUT}/${mark.id}-${stage}.png`, buf)
        console.log(`${mark.id} ${stage} thumb -> ${OUT}/${mark.id}-${stage}.png`)
      }
      const glb = mark[`${stage}Glb`]
      // Preview GLBs are shippable here, and refining is not just optional but
      // WASTED: syncClayLandmarks overwrites every mesh's material with the
      // world's clay (ClayBuildings3D passes materials[0]), so a refine's
      // texture is discarded at load. Preview geometry is the whole product.
      // Refine still wins if one exists, since its mesh is the cleaner one.
      const isBest = stage === 'refine' || !mark.refineGlb
      if (isBest && glb && !existsSync(`${OUT}/${mark.id}.glb`)) {
        const buf = Buffer.from(await (await fetch(glb)).arrayBuffer())
        writeFileSync(`${OUT}/${mark.id}.glb`, buf)
        console.log(`${mark.id} glb -> ${OUT}/${mark.id}.glb (${(buf.length / 1e6).toFixed(1)}MB)`)
      }
    }
  }
}

const command = process.argv[2]
const commands = { preview, status, refine, download }
if (!commands[command]) { console.error(`usage: ${Object.keys(commands).join(' | ')}`); process.exit(1) }
await commands[command]()
