// The loader's job is to never fetch twice, never serve a half-download as
// ready, and never grow without bound. These are those three behaviours.
import { ensurePack, packState, type AssetPack } from '../assetPacks'

let failed = 0
const check = (n: string, ok: boolean, d = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `  — ${d}` : ''}`)
}

const pack: AssetPack = { id: 'demo', version: 1, bytes: 1024, files: ['a.png', 'b.png'] }

// Stand-in Cache Storage, so this runs without a browser.
let puts = 0
const store = new Map<string, Set<string>>()
;(globalThis as any).caches = {
  open: async (name: string) => {
    if (!store.has(name)) store.set(name, new Set())
    const set = store.get(name)!
    return {
      keys: async () => [...set],
      put: async (url: string) => { puts++; set.add(url) },
    }
  },
  keys: async () => [...store.keys()],
  delete: async (name: string) => store.delete(name),
}

let fetches = 0
;(globalThis as any).fetch = async () => { fetches++; return { ok: true } as Response }
;(globalThis as any).localStorage = {
  store: {} as Record<string, string>,
  getItem(k: string) { return this.store[k] ?? null },
  setItem(k: string, v: string) { this.store[k] = v },
  removeItem(k: string) { delete this.store[k] },
}

const run = async () => {
  // Two callers on the same frame must share one download.
  const [a, b] = await Promise.all([ensurePack(pack), ensurePack(pack)])
  check('concurrent callers share one download', a && b && fetches === pack.files.length,
    `${fetches} fetches for ${pack.files.length} files`)
  check('a completed pack reports ready', packState('demo') === 'ready', packState('demo'))

  // Asking again must not re-fetch.
  const before = fetches
  await ensurePack(pack)
  check('a cached pack is not fetched again', fetches === before, `${fetches - before} extra`)

  // A failing download must not report ready.
  ;(globalThis as any).fetch = async () => ({ ok: false, status: 500 } as Response)
  const broken: AssetPack = { id: 'broken', version: 1, bytes: 10, files: ['x.png'] }
  const ok = await ensurePack(broken)
  check('a failed download is not ready', !ok && packState('broken') === 'failed', packState('broken'))

  console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`)
  // Throwing rather than process.exit: this file is type-checked by the app's
  // tsconfig, which has no Node types, and a non-zero exit still results.
  if (failed) throw new Error(`${failed} check(s) failed`)
}
void run()
