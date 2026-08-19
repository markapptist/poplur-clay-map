// mGBA/WASM behind RetroEmulatorEngine.
//
// This is the ONLY file allowed to know mGBA exists. Everything above it talks
// to the interface in retroEmulator.ts, which is what makes the eventual move to
// a native core a swap rather than a rewrite.
//
// LICENCE: @thenick775/mgba-wasm is MPL-2.0 (see poplur-arcade-emulator-cores.md),
// verified at the pinned version 1.1.1. MPL is per-file copyleft: we may ship it
// alongside proprietary code provided the core's own sources stay available and
// modified core files are published. Nothing here modifies the core -- it is
// consumed as a published artifact -- which is the whole reason the adapter lives
// on this side of the seam.
//
// ── WHY 1.1.1 AND NOT LATEST ──────────────────────────────────────────────────
//
// Deliberate, and the single most important fact in this file. Every 2.x build of
// this package is THREADED: its wasm imports SHARED memory, which the release
// notes do not put anywhere near as plainly as the bytes do.
//
//   2.0.0 .. 2.5.0   (import "a" "a" (memory 4096 4096 shared))   flags 0x03
//   1.1.1            (memory 1024 32768)                          flags 0x01
//
// Shared memory means SharedArrayBuffer, which means the whole DOCUMENT must be
// cross-origin isolated (COOP: same-origin + COEP: require-corp). Poplur cannot
// pay that: isolation is document-wide, so an isolated Poplur must serve every
// cross-origin subresource -- Mapbox tiles, Firebase, remote avatars -- with a
// CORP/CORS opt-in or they simply stop loading. An iframe does not escape it
// either; a nested context can only be isolated if its embedder already is. And
// on iOS the bundle is served from a custom scheme (poplur-clay://app) whose
// isolation behaviour in WebKit is unverified -- so that route could cost the
// whole conversion and still not work.
//
// The 1.1.1 numbers above are the other half of the argument. 2.x reserves a
// FIXED 256MB heap (min == max == 4096 pages). 1.1.1 starts at 64MB and grows to
// a 2GB ceiling only if a game asks. On the 3GB-class Android hardware the
// ambient lease already special-cases, that difference is not cosmetic.
//
// The cost of going back a major version is small and is priced in below: no
// setCoreSettings, no setLogger, no pauseAudio/resumeAudio. Each is handled with
// what 1.1.1 does expose, and each workaround says so at its call site.
//
// If a future single-threaded 2.x ships, this file is where that swap happens.

// The wasm's URL, resolved by Vite rather than by emscripten.
//
// mgba.js locates its .wasm RELATIVE TO ITSELF, and in dev Vite serves this
// package pre-bundled from node_modules/.vite/deps/ -- where no mgba.wasm sits.
// Vite's SPA fallback then answers that request with index.html, at HTTP 200,
// and the core dies on `expected magic word 00 61 73 6d, found 3c 21 64 6f`
// (that is `<!do`). A status check cannot catch this; only the content type can.
// `?url` hands the job to Vite instead: correct MIME in dev, and a hashed asset
// emitted next to the bundle in a build. Importing the URL does NOT pull the
// 1.7MB binary into the graph -- it is a string until locateFile is called.
import mgbaWasmUrl from '@thenick775/mgba-wasm/dist/mgba.wasm?url'

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

/** Emscripten's EM_TIMING_SETTIMEOUT. 1.1.1 has no setCoreSettings, so the frame
 *  cap goes through setMainLoopTiming instead of a baseFpsTarget. Mode 0 takes a
 *  millisecond interval; mode 1 (rAF) would inherit the DISPLAY's rate, which on
 *  a 120Hz ProMotion panel is exactly the overdraw the cap exists to prevent. */
const EM_TIMING_SETTIMEOUT = 0

/** Cartridge ceiling. A larger file is not a GBA ROM, whatever its extension. */
const MAX_ROM_BYTES = 32 * 1024 * 1024

/** Byte 0xB2 of every commercial GBA header is 0x96. Cheap, and it separates
 *  "this is not a GBA ROM" from "this ROM is damaged" without parsing further. */
const HEADER_MAGIC_OFFSET = 0xb2
const HEADER_MAGIC = 0x96

type MgbaModule = {
  FSInit(): Promise<void>
  FSSync(): Promise<void>
  filePaths(): { gamePath: string; savePath: string; saveStatePath: string }
  loadGame(romPath: string): boolean
  buttonPress(name: string): void
  buttonUnpress(name: string): void
  pauseGame(): void
  resumeGame(): void
  quickReload(): void
  quitGame(): void
  quitMgba(): void
  setVolume(v: number): void
  saveState(slot: number): boolean
  loadState(slot: number): boolean
  getSave(): Uint8Array
  setMainLoopTiming(mode: number, value: number): void
  addCoreCallbacks(c: Record<string, unknown>): void
  FS: {
    writeFile(path: string, data: Uint8Array): void
    readFile(path: string): Uint8Array
  }
  SDL2?: { audioContext?: { suspend(): Promise<void>; resume(): Promise<void>; state: string } }
  saveName?: string
  version?: { projectName: string; projectVersion: string }
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
    // wasm merely because someone opened the Arcade is the kind of speculative
    // work the thermal budget is there to prevent.
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
    this.booting = (async () => {
      try {
        const imported = (await import('@thenick775/mgba-wasm')) as unknown
        const factory = ((imported as { default?: unknown }).default ?? imported) as
          (o: { canvas: HTMLCanvasElement; locateFile?: (p: string) => string }) => Promise<MgbaModule>
        const mod = await factory({
          canvas: this.canvas!,
          // See the note on mgbaWasmUrl: without this the core is handed
          // index.html and dies on a wasm magic-word error.
          locateFile: (path: string) => (path.endsWith('.wasm') ? mgbaWasmUrl : path),
        })
        await mod.FSInit()
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

  /** 1.1.1's only frame-pacing lever, and it only bites once a game is loaded --
 *  emscripten has no main loop to re-time before that. Rounded to whole
 *  milliseconds because
   *  setTimeout cannot do better; 17ms is 58.8Hz against the GBA's 59.73, and
   *  erring SLOW is the right side to miss on -- a core running fast is heat and
   *  a pitch-shifted soundtrack, a core running 1.5% slow is neither. */
  private applyFrameCap(mod: MgbaModule): void {
    mod.setMainLoopTiming(EM_TIMING_SETTIMEOUT, Math.max(1, Math.round(1000 / this.capHz)))
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
      const romPath = `${mod.filePaths().gamePath}/${romId}.gba`
      mod.FS.writeFile(romPath, rom)
      if (!mod.loadGame(romPath)) {
        this._state = 'error'
        return { ok: false, failure: 'corrupt_rom', detail: 'the core refused the ROM' }
      }
      // Applied HERE, not at boot: setMainLoopTiming configures a main loop that
      // does not exist until a game is loaded, so capping earlier is a no-op.
      this.applyFrameCap(mod)
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
    return {
      // Stamped with the engine that wrote it. A state is core-private, so a
      // future native core MUST be able to refuse this rather than feed another
      // engine's bytes to its own loader.
      engineId: this.engineId,
      romId: this.romId,
      createdAt: Date.now(),
      data: mod.FS.readFile(`${mod.filePaths().saveStatePath}/${this.romId}.ss${slot}`),
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
    return this.mod.getSave() ?? null
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

  /** 1.1.1 has no pauseAudio/resumeAudio, so this suspends the core's own
   *  AudioContext instead of muting it. That is the better lever anyway: a
   *  volume of 0 still runs the ScriptProcessor and still bills its callback
   *  every buffer, which is precisely the idle work the thermal gate hunts. */
  setAudioEnabled(enabled: boolean): void {
    const ctx = this.mod?.SDL2?.audioContext
    if (!ctx) return
    void (enabled ? ctx.resume() : ctx.suspend())
  }

  setVolume(volume: number): void {
    this.mod?.setVolume(Math.max(0, Math.min(1, volume)))
  }

  setFrameRateCap(fps: number): void {
    // Never above the hardware's own rate: see GBA_HZ.
    this.capHz = Math.max(1, Math.min(GBA_HZ, fps))
    if (this.mod) this.applyFrameCap(this.mod)
  }

  sample(): RetroPerfSample {
    const now = performance.now()
    const elapsed = Math.max(1, now - (this.lastSampleAt || now))
    const produced = this.frames - this.lastSampleFrames
    this.lastSampleAt = now
    this.lastSampleFrames = this.frames
    // Against the cap the core was ASKED for, not against 60.
    const expected = (this.capHz * elapsed) / 1000
    return {
      fps: (produced * 1000) / elapsed,
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
