// The seam between Poplur's Arcade UI and whichever emulator core we end up
// shipping.
//
// The core is NOT chosen yet (see poplur-arcade-emulator-cores.md — mGBA/MPL-2.0
// is the recommendation, pending verification). That decision has a licence
// consequence that outlives any UI work, so nothing above this file is allowed
// to know which core is underneath: the shell talks to RetroEmulatorEngine and
// only to RetroEmulatorEngine.
//
// The concrete reason this matters here rather than in the abstract: the plan is
// to prove the pipeline on a WASM build and move to native for frame pacing and
// thermal headroom. That swap must not touch the shell, the controls or the
// library. If anything starts reaching past this interface for a core-specific
// handle, that swap stops being free.

/** Physical GBA inputs. The shell maps touches to these; nothing else does. */
export type RetroButton =
  | 'up' | 'down' | 'left' | 'right'
  | 'a' | 'b'
  | 'start' | 'select'
  | 'l' | 'r'

export type RetroEngineState =
  | 'idle'        // constructed, no ROM
  | 'loading'     // ROM being read/parsed
  | 'ready'       // ROM loaded, not yet running
  | 'running'
  | 'paused'
  | 'error'

/** Why a load failed. Distinguished so the UI can say something true rather than
 *  "something went wrong" — a corrupt ROM and an unsupported core are different
 *  conversations with the user. */
export type RetroLoadFailure =
  | 'unsupported_format'
  | 'corrupt_rom'
  | 'too_large'
  | 'core_unavailable'
  | 'out_of_memory'

export interface RetroLoadResult {
  ok: boolean
  failure?: RetroLoadFailure
  /** Developer-facing only. Never surface raw core output to a player. */
  detail?: string
}

/** A point-in-time snapshot. Opaque bytes: the format belongs to the core, and a
 *  state written by one core is NOT portable to another — persist the engine id
 *  alongside it or a core swap silently invalidates everyone's saves. */
export interface RetroSaveState {
  engineId: string
  romId: string
  createdAt: number
  data: Uint8Array
}

/** Frame pacing, for the profiler and the thermal work. This exists because the
 *  brief says to measure rather than assume, and because an emulator that quietly
 *  runs at 120fps on a ProMotion display is exactly the kind of thing that has
 *  overheated this app before. */
export interface RetroPerfSample {
  fps: number
  /** Emulated frames dropped since the last sample. */
  droppedFrames: number
  /** Wall-clock ms spent emulating one frame; the budget is 16.7ms. */
  frameTimeMs: number
  audioUnderruns: number
}

export interface RetroEmulatorEngine {
  /** Stable identifier for the concrete engine, e.g. "mgba-wasm". Persisted with
   *  save states so a core swap can detect and refuse incompatible ones. */
  readonly engineId: string

  readonly state: RetroEngineState

  /** Attach the engine to a surface. Separate from loadGame so the shell can
   *  reserve and position the screen opening before a ROM exists. */
  attach(canvas: HTMLCanvasElement): void
  detach(): void

  loadGame(rom: Uint8Array, romId: string): Promise<RetroLoadResult>

  start(): void
  pause(): void
  resume(): void
  reset(): void

  saveState(): Promise<RetroSaveState>
  loadState(state: RetroSaveState): Promise<boolean>

  /** Battery-backed cartridge save (SRAM/Flash/EEPROM), distinct from a save
   *  state: this is the save the GAME itself writes, and it must survive a core
   *  swap where a save state need not. */
  readBatterySave(): Promise<Uint8Array | null>
  writeBatterySave(data: Uint8Array): Promise<void>

  setButtonPressed(button: RetroButton): void
  setButtonReleased(button: RetroButton): void
  /** Release everything. Called on backgrounding and on losing a pointer, so a
   *  held direction cannot stick down after the finger is gone. */
  releaseAllButtons(): void

  setAudioEnabled(enabled: boolean): void
  setVolume(volume: number): void

  /** Cap the emulated frame rate. The GBA runs at ~59.73Hz; anything above that
   *  is wasted heat on a 120Hz display. */
  setFrameRateCap(fps: number): void

  /** Poll for profiling. Deliberately pull-based — a push callback per frame is
   *  itself per-frame work on the path we are trying to keep cheap. */
  sample(): RetroPerfSample

  /** Free everything: core memory, audio graph, canvas contexts, workers.
   *  Must be safe to call twice. */
  dispose(): void
}

/** Reasons the host suspends the engine. Named so the pause is attributable in a
 *  log rather than appearing as an unexplained stall — the same lesson as the
 *  splash cover, where a suspended document looked like a broken video. */
export type RetroSuspendReason =
  | 'app_backgrounded'
  | 'screen_hidden'
  | 'thermal_pressure'
  | 'memory_pressure'
  | 'user_paused'
  | 'call_interrupted'

/** The host contract the Arcade screen implements.
 *
 *  The brief is explicit that the emulator must not keep running at full speed
 *  when Poplur is backgrounded, and that opening it should quiet the rest of the
 *  app. Both are host responsibilities, not engine ones — the engine cannot know
 *  the map is still rendering behind it. */
export interface RetroEmulatorHost {
  suspend(reason: RetroSuspendReason): void
  resumeFrom(reason: RetroSuspendReason): void
  /** Called when the engine reports sustained frame-time overrun, so the host can
   *  decide (lower the cap, drop audio, or tell the player) rather than the
   *  engine silently degrading. */
  onPerformanceWarning(sample: RetroPerfSample): void
}
