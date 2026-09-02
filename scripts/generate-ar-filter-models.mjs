#!/usr/bin/env node
/**
 * Generate the AR filters' 3D parts with Meshy.
 *
 * FaceAR3D used to build each filter's accessory out of torus/box/octahedron
 * primitives in code. This asks Meshy for a real low-poly GLB of the same
 * design instead, through the same Poplur proxy the avatar studio uses
 * (`/text-to-3d`, which owns the Meshy key — it never touches this machine).
 *
 * Output lands in the ar-filters asset pack as models/<id>.glb, and both
 * catalogs (bundled + published) gain a `model` entry with the fit FaceAR3D
 * applies after normalizing the mesh to face units. A filter without a model
 * keeps its procedural accessory, so a half-finished run never blanks a rail.
 *
 * Every generation spends Meshy credits, so the run is sequential, aborts on
 * the first failure, skips filters whose GLB already exists, and takes
 * `--only <id>` to do one at a time.
 *
 * Usage: node scripts/generate-ar-filter-models.mjs [--only glow] [--force] [--dry-run]
 */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODELS_DIR = resolve(ROOT, 'public/ar-filters/models');
const CATALOGS = [resolve(ROOT, 'src/arFilterCatalog.json'), resolve(ROOT, 'public/ar-filters/catalog.json')];
const POLL_MS = 5_000;
const TIMEOUT_MS = 30 * 60_000; // preview + refine, each up to ~15 min
/** poplur2025's public web API key (the same one the RN app ships). It only
 *  routes a custom token to the right project; it is not a secret. */
const WEB_API_KEY = 'AIzaSyC_b3-zHngzP-MKa1Cx5yclbV_6DlvGe_w';
/** The admin allowlisted in poplurConfig/meshy. */
const ADMIN_UID = 'eoP2Z0ElxIa0Eua7xpFxNlr6tur1';
const FUNCTIONS_REQUIRE = createRequire('/Users/matrix/Developer/Poplur2025-iOS/functions/');

/**
 * One prompt per accessory, written from the procedural design it replaces so
 * the look survives the switch. `scale` is the model's longest side in face
 * widths; `offset` is in face units, +y up, applied after centering.
 */
const DESIGNS = {
  // Keyed by the LIVE catalog ids (public/ar-filters/catalog.json), each
  // prompt written from that filter's own thumbnail.
  angel: {
    prompt: 'A polished gold angel halo ring floating at a slight tilt, glowing softly, with a pair of small white feathered angel wings behind it, stylised, clean low-poly, no background',
    scale: 0.85, offset: [0, 0.55, 0],
  },
  'pop-3d': {
    prompt: 'Classic white paper 3D anaglyph glasses with one red lens and one cyan lens, cardboard frame, front view, clean low-poly, no background',
    scale: 1.3, offset: [0, 0.08, 0],
  },
  'heart-crown': {
    prompt: 'A crown made of glossy hot-pink hearts on a thin gold band, hearts standing upright around the band, stylised, clean low-poly, no background',
    scale: 1.05, offset: [0, 0.5, 0],
  },
  'flower-crown': {
    prompt: 'A flower crown of pastel pink, white and yellow daisies and small green leaves on a thin vine band, stylised, clean low-poly, no background',
    scale: 1.1, offset: [0, 0.48, 0],
  },
  'dino-hood': {
    prompt: 'A cute green dinosaur hoodie hood with rounded eyes on top and a row of soft spikes down the back, worn open like a hat, stylised, clean low-poly, no background',
    scale: 1.25, offset: [0, 0.35, 0],
  },
  'puppy-love': {
    prompt: 'A pair of floppy golden-brown puppy ears on a thin headband with a small black puppy nose, cute and stylised, clean low-poly, no background',
    scale: 1.15, offset: [0, 0.25, 0],
  },
  'butterfly-dream': {
    prompt: 'Three small iridescent blue and purple butterflies with open wings, floating together as a cluster, stylised, clean low-poly, no background',
    scale: 0.9, offset: [0.35, 0.3, 0],
  },
};

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const only = args.includes('--only')
  ? args[args.indexOf('--only') + 1].split(',').map(v => v.trim()).filter(Boolean)
  : null;

/**
 * The proxy wants a Firebase ID token for an admin. Mint a custom token for
 * the admin uid with the Admin SDK (Application Default Credentials — the
 * same way the cleanup scripts run) and exchange it. No password anywhere.
 * POPLUR_ID_TOKEN in the environment skips the mint entirely.
 */
async function idToken() {
  if (process.env.POPLUR_ID_TOKEN) return process.env.POPLUR_ID_TOKEN;
  const admin = FUNCTIONS_REQUIRE('firebase-admin');
  // A user credential cannot sign a custom token itself; it signs THROUGH the
  // project's default service account via IAM signBlob (the project owner
  // holds that permission). Nothing is downloaded or stored.
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: 'poplur2025',
    serviceAccountId: 'poplur2025@appspot.gserviceaccount.com',
  });
  const custom = await admin.auth().createCustomToken(ADMIN_UID);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_API_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  if (!res.ok) throw new Error(`could not exchange the admin token (${res.status})`);
  const { idToken: token } = await res.json();
  if (!token) throw new Error('no ID token returned');
  return token;
}

async function endpoint() {
  if (process.env.POPLUR_MESHY_ENDPOINT) return process.env.POPLUR_MESHY_ENDPOINT.replace(/\/+$/, '');
  const env = await readFile(resolve(ROOT, '.env'), 'utf8').catch(() => '');
  const line = env.split('\n').find(l => l.startsWith('VITE_POPLUR_MESHY_ENDPOINT='));
  const value = line ? line.slice('VITE_POPLUR_MESHY_ENDPOINT='.length).trim().replace(/\/+$/, '') : '';
  if (!/^https:\/\//.test(value)) throw new Error('No Poplur Meshy proxy endpoint configured (VITE_POPLUR_MESHY_ENDPOINT).');
  return value;
}

async function generate(base, token, id, design) {
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  const created = await fetch(`${base}/meshyGenerate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt: design.prompt, kind: 'ar-filter', name: `poplur_ar_${id}` }),
  });
  if (!created.ok) {
    const body = await created.text().catch(() => '');
    throw new Error(`proxy refused the job (${created.status}) ${body.slice(0, 160)}`);
  }
  const { taskId } = await created.json();
  if (!taskId) throw new Error('proxy returned no job id');
  process.stdout.write(`  ${id.padEnd(9)} job ${taskId} `);

  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise(r => setTimeout(r, POLL_MS));
    const polled = await fetch(`${base}/meshyStatus/${encodeURIComponent(taskId)}`, { headers });
    if (!polled.ok) throw new Error(`lost the job (${polled.status})`);
    const task = await polled.json();
    process.stdout.write(task.progress != null ? `${task.progress}% ` : '.');
    if (task.status === 'FAILED') throw new Error(task.error || 'Meshy failed (the proxy refunded the credits)');
    if (task.status !== 'SUCCEEDED') continue;
    const url = task.modelUrl;
    if (!url) throw new Error('finished without a GLB');
    const glb = await fetch(url);
    if (!glb.ok) throw new Error(`GLB download failed (${glb.status})`);
    const bytes = Buffer.from(await glb.arrayBuffer());
    if (bytes.subarray(0, 4).toString('ascii') !== 'glTF') throw new Error('download is not a GLB');
    await writeFile(resolve(MODELS_DIR, `${id}.glb`), bytes);
    console.log(` ${(bytes.length / 1024).toFixed(0)} KB`);
    return;
  }
}

async function patchCatalogs(done) {
  for (const path of CATALOGS) {
    const catalog = JSON.parse(await readFile(path, 'utf8'));
    for (const entry of catalog.filters) {
      const design = DESIGNS[entry.id];
      if (design && done.has(entry.id)) {
        entry.model = { file: `models/${entry.id}.glb`, scale: design.scale, offset: design.offset };
      }
    }
    await writeFile(path, `${JSON.stringify(catalog, null, 2)}\n`);
  }
}

async function main() {
  await mkdir(MODELS_DIR, { recursive: true });
  const ids = Object.keys(DESIGNS).filter(id => !only || only.includes(id));
  if (only && !ids.length) throw new Error(`no design for "${only}"; known: ${Object.keys(DESIGNS).join(', ')}`);
  if (flag('dry-run')) { ids.forEach(id => console.log(`${id}: ${DESIGNS[id].prompt}`)); return; }
  const base = await endpoint();
  const token = await idToken();
  const done = new Set();
  for (const id of ids) {
    const exists = await stat(resolve(MODELS_DIR, `${id}.glb`)).then(() => true, () => false);
    if (exists && !flag('force')) { console.log(`  ${id.padEnd(9)} exists — skipped (use --force)`); done.add(id); continue; }
    try { await generate(base, token, id, DESIGNS[id]); done.add(id); }
    catch (error) { console.error(`\n  ${id}: FAILED — ${error.message}\n  Stopping here so no further credits are spent.`); break; }
  }
  await patchCatalogs(done);
  console.log(`\n${done.size}/${ids.length} model(s) in place; catalogs patched for those.`);
  if (done.size < ids.length) process.exit(1);
}
await main();
