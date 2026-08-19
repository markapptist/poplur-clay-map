// mGBA/WASM behind RetroEmulatorEngine.
//
// This is the ONLY file allowed to know mGBA exists. Everything above it talks
// to the interface in retroEmulator.ts, which is what makes the eventual move to
// a native core a swap rather than a rewrite.
//
// LICENCE: @thenick775/mgba-wasm is MPL-2.0 (see poplur-arcade-emulator-cores.md).
// MPL is per-file copyleft: we may ship it alongside proprietary code provided
// the core's own sources stay available and modified core files are published.
// Nothing here modifies the core -- it is consumed as a published artifact --
// which is the whole reason the adapter lives on this side of the seam.
//
// ── A HARD CONSTRAINT, discovered by wiring it rather than by reading about it ──
//
// This build is THREADED. Its wasm imports shared memory:
//
//     (import "a" "a" (memory 4096 4096 shared))      flags 0x03
//
// which means SharedArrayBuffer, which means the document must be
// CROSS-ORIGIN ISOLATED (COOP: same-origin + COEP: require-corp). Poplur sets
// neither today. Isolation is a DOCUMENT-wide property, so it cannot be scoped
// to the Arcade: an isolated Poplur must serve every cross-origin subresource
// (Mapbox tiles, Firebase, remote avatars) with CORP/CORS opt-in headers or they
// stop loading. An iframe does not escape this -- a nested context can only be
// isolated if its top-level embedder already is.
//
// The min == max == 4096 pages above is also worth reading literally: this core
// reserves a FIXED 256 MB heap. On the 3GB-class Android hardware the ambient
// lease already special-cases, that is not a rounding error.
//
// Consequences are recorded rather than routed around:
//   - dev: `POPLUR_COI=1 npm run dev` sets the two headers (see vite.config).
//   - native: neither WebView uses file:// for this bundle -- iOS serves it from
//     a WKURLSchemeHandler on poplur-clay://app, Android from a
//     WebViewAssetLoader -- so both CAN attach the headers to their responses.
//     Neither does today, and whether WebKit grants crossOriginIsolated on a
//     custom scheme is unverified; that handler already documents WebKit
//     ignoring its Cache-Control, so do not assume uniform header handling.
//   - if that cost is unacceptable, the alternative is a SINGLE-THREADED mGBA
//     build, which needs no isolation. That is a core-selection decision, and
//     it belongs to whoever owns the licence review -- not to this adapter.
//
// isolationBlocked() below reports the condition by name instead of letting it
// surface as an unexplained failure to boot.

import type {
  RetroButton,
  RetroEmulatorEngine,
  RetroEngineState,
  RetroLoadResult,
  RetroPerfSample,
  RetroSaveState,
} from './retroEmulator'

/** Poplur's button names -> the core's. The core takes SDL-ish names; keeping
 *  the mapping in one table is what lets the shell stay ignorant of them. */
const BUTTON_NAME: Record<RetroButton, string> = {
  up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  a: 'A', b: 'B', start: 'Start', select: 'Select', l: 'L', r: 'R',
}

/** The GBA's real refresh. Not 60: capping at 60 asks the core for 0.45% more
 *  frames than the hardware ever produced, which is heat for nothing. */
export const GBA_HZ = 59.7275

/** Cartridge ceiling. A larger file is not a GBA ROM, whatever its extension. */
const MAX_ROM_BYTES = 32 * 1024 * 1024

/** Byte 0xB2 of every commercial GBA header is 0x96. Cheap, and it separates
 *  "this is not a GBA ROM" from "this ROM is damaged" without parsing further. */
const HEADER_MAGIC_OFFSET = 0xb2
const HEADER_MAGIC = 0x96

/** True when the page cannot host a threaded core. Named so a failure to start
 *  reads as a deployment fact rather than a mysterious core crash. */
export function isolationBlocked(): boolean {
  return typeof globalThis.crossOriginIsolated === 'boolean' && !globalThis.crossOriginIsolated
}

type MgbaModule = {
  FSInit(): Promise<void>
  FSSync(): Promise<void>
  filePaths(): { gamePath: string; savePath: string; saveStatePath: string }
  loadGame(romPath: string, savePathOverride?: string): boolean
  buttonPress(name: string): void
  buttonUnpress(name: string): void
  pauseGame(): void
  resumeGame(): void
  quickReload(): void
  quitGame(): void
  quitMgba(): void
  pauseAudio(): void
  resumeAudio(): void
  setVolume(v: number): void
  saveState(slot: number): boolean
  loadState(slot: number): boolean
  getSave(): Uint8Array | null
  setCoreSettings(s: Record<string, unknown>): void
  addCoreCallbacks(c: Record<string, unknown>): void
  setLogger(cb: ((e: { level: string; category: string; message: string }) => void) | null): void
  FS: {
    writeFile(path: string, data: Uint8Array): void
    readFile(path: string): Uint8Array
    analyzePath(path: string): { exists: boolean }
    unlink(path: string): void
  }
  saveName?: string
}

export class MgbaEngine implements RetroEmulatorEngine {
  readonly engineId = 'mgba-wasm'

  private _state: RetroEngineState = 'idle'
  get state(): RetroEngineState { return this._state }

  private canvas: HTMLCanvasElement | null = null
  private mod: MgbaModule | null = null
  private booting: Promise<MgbaModule | null> | null = null
  private romId = ''
  private held = new Set<RetroButton>()
  private disposed = false
  private volume = 1
  private capHz = GBA_HZ

  // Frame accounting for sample(). Pull-based by contract, so the callback does
  // the cheapest possible thing -- bump a counter and stamp a time -- and all
  // the arithmetic happens when someone actually asks.
  private frames = 0
  private lastSampleAt = 0
  private lastSampleFrames = 0
  private lastFrameAt = 0
  private frameTimeMs = 0

  /** Developer-facing detail for the most recent failure. */
  private lastError = ''

  attach(canvas: HTMLCanvasElement): void {
    if (this.disposed) return
    this.canvas = canvas
    // Deliberately NOT booting the core here. attach() exists so the shell can
    // position the screen opening before a ROM exists, and booting 1.7MB of
    // wasm plus a 256MB heap merely because someone opened the Arcade is the
    // kind of speculative work the thermal budget is there to prevent.
  }

  detach(): void {
    this.pause()
    this.canvas = null
  }

  /** Boot the core once, lazily. The dynamic import keeps the wasm out of the
   *  main bundle: the Arcade is one screen and must not tax app start. */
  private async boot(): Promise<MgbaModule | null> {
    if (this.mod) return this.mod
    if (this.booting) return this.booting
    if (!this.canvas) { this.lastError = 'attach() must be called before loadGame()'; return null }
    if (isolationBlocked()) {
      this.lastError =
        'crossOriginIsolated is false: this mGBA build imports shared memory and needs ' +
        'COOP: same-origin + COEP: require-corp. See the header of retroEngineMgba.ts.'
      return null
    }
    this.booting = (async () => {
      try {
        const imported = (await import('@thenick775/mgba-wasm')) as unknown
        const factory = ((imported as { default?: unknown }).default ?? imported) as
          (o: { canvas: HTMLCanvasElement }) => Promise<MgbaModule>
        const mod = await factory({ canvas: this.canvas! })
        await mod.FSInit()
        // Route core logs through one place; the default is console spam that
        // would drown the app's own diagnostics on a device.
        mod.setLogger(e => {
          if (e.level === 'FATAL' || e.level === 'ERROR') {
            console.error(`[mgba:${e.category}] ${e.message}`)
          }
        })
        mod.addCoreCallbacks({
          videoFrameEndedCallback: () => {
            const now = performance.now()
            if (this.lastFrameAt) this.frameTimeMs = now - this.lastFrameAt
            this.lastFrameAt = now
            this.frames++
          },
          coreCrashedCallback: () => {
            this._state = 'error'
            this.lastError = 'the core reported a crash'
          },
        })
        this.applySettings(mod)
        this.mod = mod
        return mod
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : String(err)
        return null
      } finally {
        this.booting = null
      }
    })()
    return this.booting
  }

  private applySettings(mod: MgbaModule): void {
    mod.setCoreSettings({
      baseFpsTarget: this.capHz,
      // Timestep sync, not vsync: vsync on a 120Hz ProMotion panel asks a 59.7Hz
      // machine to keep the display's pace, which is exactly the overdraw the
      // thermal work has been removing everywhere else in this app.
      videoSync: false,
      audioSync: false,
      timestepSync: true,
      // Rewind keeps a rolling buffer of states. On top of a fixed 256MB heap
      // that is memory we have not budgeted, and nothing in the UI offers it.
      rewindEnable: false,
      autoSaveStateEnable: false,
      restoreAutoSaveStateOnLoad: false,
      showFpsCounter: false,
      // A real D-pad cannot report left and right at once; allowing it lets a
      // sloppy multi-touch frame put a game into a state hardware never could.
      allowOpposingDirections: false,
    })
  }

  async loadGame(rom: Uint8Array, romId: string): Promise<RetroLoadResult> {
    if (this.disposed) return { ok: false, failure: 'core_unavailable', detail: 'engine disposed' }
    this._state = 'loading'

    if (rom.byteLength > MAX_ROM_BYTES) {
      this._state = 'error'
      return { ok: false, failure: 'too_large', detail: `${rom.byteLength} bytes exceeds the 32MB cartridge ceiling` }
    }
    if (rom.byteLength < 0xc0) {
      this._state = 'error'
      return { ok: false, failure: 'corrupt_rom', detail: 'shorter than a GBA header' }
    }
    if (rom[HEADER_MAGIC_OFFSET] !== HEADER_MAGIC) {
      this._state = 'error'
      return { ok: false, failure: 'unsupported_format', detail: 'GBA header magic 0x96 absent at 0xB2' }
    }

    const mod = await this.boot()
    if (!mod) {
      this._state = 'error'
      return { ok: false, failure: 'core_unavailable', detail: this.lastError }
    }

    try {
      const paths = mod.filePaths()
      const romPath = `${paths.gamePath}/${romId}.gba`
      mod.FS.writeFile(romPath, rom)
      if (!mod.loadGame(romPath)) {
        this._state = 'error'
        return { ok: false, failure: 'corrupt_rom', detail: 'the core refused the ROM' }
      }
      this.romId = romId
      this.frames = 0
      this.lastSampleAt = performance.now()
      this.lastSampleFrames = 0
      // loadGame starts the core running; the contract says a load leaves the
      // engine READY and start() is what runs it.
      mod.pauseGame()
      this._state = 'ready'
      return { ok: true }
    } catch (err) {
      this._state = 'error'
      const detail = err instanceof Error ? err.message : String(err)
      // Emscripten surfaces an exhausted heap as an abort, not a typed error.
      const oom = /memory|allocat|abort/i.test(detail)
      return { ok: false, failure: oom ? 'out_of_memory' : 'corrupt_rom', detail }
    }
  }

  start(): void {
    if (!this.mod || this._state === 'running') return
    this.mod.resumeGame()
    this._state = 'running'
  }

  pause(): void {
    if (!this.mod || this._state !== 'running') return
    this.mod.pauseGame()
    this._state = 'paused'
  }

  resume(): void {
    if (!this.mod || this._state !== 'paused') return
    this.mod.resumeGame()
    this._state = 'running'
  }

  reset(): void {
    if (!this.mod) return
    this.releaseAllButtons()
    this.mod.quickReload()
  }

  async saveState(): Promise<RetroSaveState> {
    const mod = this.mod
    if (!mod) throw new Error('no core loaded')
    const slot = 1
    if (!mod.saveState(slot)) throw new Error('the core refused to write a save state')
    await mod.FSSync()
    const path = `${mod.filePaths().saveStatePath}/${this.romId}.ss${slot}`
    return {
      // Stamped with the engine that wrote it. A state is core-private, so a
      // future native core MUST be able to refuse this rather than feed another
      // engine's bytes to its own loader.
      engineId: this.engineId,
      romId: this.romId,
      createdAt: Date.now(),
      data: mod.FS.readFile(path),
    }
  }

  async loadState(state: RetroSaveState): Promise<boolean> {
    const mod = this.mod
    if (!mod) return false
    // The refusal the interface was designed around.
    if (state.engineId !== this.engineId) return false
    if (state.romId !== this.romId) return false
    try {
      const slot = 1
      mod.FS.writeFile(`${mod.filePaths().saveStatePath}/${this.romId}.ss${slot}`, state.data)
      await mod.FSSync()
      return mod.loadState(slot)
    } catch {
      return false
    }
  }

  async readBatterySave(): Promise<Uint8Array | null> {
    if (!this.mod) return null
    await this.mod.FSSync()
    return this.mod.getSave()
  }

  async writeBatterySave(data: Uint8Array): Promise<void> {
    const mod = this.mod
    if (!mod?.saveName) return
    mod.FS.writeFile(mod.saveName, data)
    await mod.FSSync()
  }

  setButtonPressed(button: RetroButton): void {
    if (this.held.has(button)) return       // the shell re-reports held buttons on every move
    this.held.add(button)
    this.mod?.buttonPress(BUTTON_NAME[button])
  }

  setButtonReleased(button: RetroButton): void {
    if (!this.held.delete(button)) return
    this.mod?.buttonUnpress(BUTTON_NAME[button])
  }

  releaseAllButtons(): void {
    this.held.forEach(b => this.mod?.buttonUnpress(BUTTON_NAME[b]))
    this.held.clear()
  }

  setAudioEnabled(enabled: boolean): void {
    if (!this.mod) return
    if (enabled) this.mod.resumeAudio()
    else this.mod.pauseAudio()
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume))
    this.mod?.setVolume(this.volume)
  }

  setFrameRateCap(fps: number): void {
    // Never above the hardware's own rate: see GBA_HZ.
    this.capHz = Math.max(1, Math.min(GBA_HZ, fps))
    if (this.mod) this.applySettings(this.mod)
  }

  sample(): RetroPerfSample {
    const now = performance.now()
    const elapsed = Math.max(1, now - (this.lastSampleAt || now))
    const produced = this.frames - this.lastSampleFrames
    this.lastSampleAt = now
    this.lastSampleFrames = this.frames
    const fps = (produced * 1000) / elapsed
    // Against the cap the core was ASKED for, not against 60.
    const expected = (this.capHz * elapsed) / 1000
    return {
      fps,
      droppedFrames: Math.max(0, Math.round(expected - produced)),
      frameTimeMs: this.frameTimeMs,
      // Honest zero: this build exposes no underrun counter. Reporting a
      // fabricated number here would corrupt the very profiling the thermal
      // work depends on, so it stays 0 and is documented as unmeasured.
      audioUnderruns: 0,
    }
  }

  dispose(): void {
    if (this.disposed) return          // "must be safe to call twice"
    this.disposed = true
    try {
      this.releaseAllButtons()
      this.mod?.quitGame()
      this.mod?.quitMgba()
    } catch { /* tearing down a core that already died is not an error */ }
    this.mod = null
    this.canvas = null
    this._state = 'idle'
  }
}
