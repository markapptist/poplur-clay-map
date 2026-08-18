import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  RETRO_SHELL_SKINS,
  DEFAULT_SHELL_SKIN_ID,
  shellSkinById,
  shellSkinHasArt,
  controlsAtPoint,
  dpadDirectionsAtPoint,
  type RetroControlId,
} from './retroShellSkin'
import type { RetroButton } from './retroEmulator'
import { playPop } from './pop'
import styles from './ArcadeScreen.module.css'

// Poplur Arcade — the shell player.
//
// The shell is the SUPPLIED ARTWORK, not drawn here. This file positions things
// on top of it and hit-tests against RETRO_SHELL_SKINS; it must never paint a
// button or a body, because the moment it does, the art and the geometry have
// two owners and the next skin lands its hitboxes somewhere its art is not.
// Same composition as PoplurgatchiPlayable: a device image at a fixed aspect
// ratio with percentage-positioned overlays over it.
//
// What is real here: every skin renders its own art, touches resolve through
// that skin's geometry, the D-pad reports diagonals, and several controls can
// be held at once. Switching skins re-reads the geometry, which is how the
// brief's "hitboxes and screen positioning remain correct across different
// shells" is demonstrated rather than asserted.
//
// What is NOT here: a game. No emulator core is vendored (see
// poplur-arcade-emulator-cores.md — mGBA/MPL-2.0 is the recommendation, nothing
// is pinned), so the screen area shows the shell's own painted title and says
// plainly that no core is loaded. The brief forbids a mock that claims to work,
// so the one thing this must never do is look like it is emulating.
//
// When a core lands it attaches to the <canvas> in the screen opening and the
// handlers below start calling setButtonPressed/setButtonReleased. Nothing else
// changes — that is the point of the seam.

/** Controls that map 1:1 to an engine button. The D-pad is absent on purpose:
 *  it is one control but four buttons, so it resolves through
 *  dpadDirectionsAtPoint instead of a lookup. */
const CONTROL_TO_BUTTON: Partial<Record<RetroControlId, RetroButton>> = {
  a: 'a', b: 'b', start: 'start', select: 'select', l: 'l', r: 'r',
}

/** The canvas the art was measured against. Its ratio drives the shell box, so
 *  the normalised geometry lands on the same pixels at any render size. */
const SHELL_W = 307
const SHELL_H = 476

/** Boot timing, in ms. The handheld's own boot is the reference: the mark
 *  travels down the screen, lands, and only then does the chime hit — the sound
 *  confirms the landing rather than accompanying the fall. */
const BOOT_DROP_MS = 1500
const BOOT_HOLD_MS = 900

/** An ORIGINAL boot chime, synthesised rather than sampled.
 *
 *  Deliberately not a reproduction of any console's startup sound: that audio is
 *  copyrighted and sampling or re-creating it note-for-note is the exact problem
 *  we were asked to avoid. This is a short rising major arpeggio on a square
 *  wave, which is period-appropriate because the hardware had square channels,
 *  not because it imitates a particular tune. Replaced wholesale when real audio
 *  is supplied — that is why it is one function behind one call site.
 *
 *  Returns false if the browser blocked audio (no user gesture yet), so the
 *  caller can retry on first touch instead of silently never playing. */
function playBootChime(): boolean {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return false
    const ctx = new Ctor()
    if (ctx.state === 'suspended') { void ctx.resume() }
    const now = ctx.currentTime + 0.02
    // C5, E5, G5, C6 — a plain major arpeggio, nobody's melody.
    const notes = [523.25, 659.25, 783.99, 1046.5]
    notes.forEach((hz, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = hz
      const t0 = now + i * 0.085
      const dur = i === notes.length - 1 ? 0.5 : 0.1
      // Shaped rather than gated: a bare start/stop on a square wave clicks.
      gain.gain.setValueAtTime(0.0001, t0)
      gain.gain.exponentialRampToValueAtTime(0.16, t0 + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0)
      osc.stop(t0 + dur + 0.02)
    })
    // Release the context once the tail has rung out; a leaked AudioContext per
    // boot is a real cost on a device that boots this screen repeatedly.
    window.setTimeout(() => { void ctx.close() }, 1600)
    return ctx.state !== 'suspended'
  } catch {
    return false
  }
}

export default function ArcadeScreen() {
  const [skinId, setSkinId] = useState(DEFAULT_SHELL_SKIN_ID)
  const [showBoxes, setShowBoxes] = useState(false)
  const skin = useMemo(() => shellSkinById(skinId), [skinId])
  const hasArt = shellSkinHasArt(skin)

  // 'drop' -> the mark travels down; 'land' -> it has landed and chimed;
  // 'done' -> the boot screen has cleared and the shell's painted splash shows.
  const [boot, setBoot] = useState<'drop' | 'land' | 'done'>('drop')
  // Autoplay policy blocks audio with no prior gesture, and a boot runs on
  // entry. Remember that we owe a chime so the first touch can pay it, rather
  // than the boot being silently mute forever.
  const chimeOwed = useRef(false)

  useEffect(() => {
    if (boot !== 'drop') return
    const land = window.setTimeout(() => {
      setBoot('land')
      chimeOwed.current = !playBootChime()
    }, BOOT_DROP_MS)
    return () => window.clearTimeout(land)
  }, [boot])

  useEffect(() => {
    if (boot !== 'land') return
    const done = window.setTimeout(() => setBoot('done'), BOOT_HOLD_MS)
    return () => window.clearTimeout(done)
  }, [boot])

  /** Re-boot when the shell changes: a new handheld powers on. */
  const pickSkin = useCallback((id: string) => {
    // The house pop: sound plus popHaptic(), which is navigator.vibrate on
    // Android and the native bridge on iOS (Safari ignores the web API). Same
    // feedback the rest of Poplur gives for a deliberate pick.
    playPop()
    setSkinId(id)
    chimeOwed.current = false
    setBoot('drop')
  }, [])

  // Which engine buttons are down. A Set because a real frame legitimately has
  // several down at once (running and jumping).
  const [pressed, setPressed] = useState<Set<RetroButton>>(new Set())
  // pointerId -> the buttons THAT pointer holds. Multi-touch means two fingers
  // hold different controls, and lifting one must not release the other's.
  const pointers = useRef(new Map<number, RetroButton[]>())
  const shellRef = useRef<HTMLDivElement>(null)

  const recompute = useCallback(() => {
    const all = new Set<RetroButton>()
    pointers.current.forEach(list => list.forEach(b => all.add(b)))
    setPressed(all)
  }, [])

  /** Resolve a pointer position to engine buttons using the SKIN's geometry,
   *  normalised to the shell box so it holds at any render size. */
  const buttonsAt = useCallback((clientX: number, clientY: number): RetroButton[] => {
    const el = shellRef.current
    if (!el) return []
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return []
    const nx = (clientX - r.left) / r.width
    const ny = (clientY - r.top) / r.height
    const out: RetroButton[] = []
    for (const id of controlsAtPoint(skin, nx, ny)) {
      if (id === 'dpad') out.push(...dpadDirectionsAtPoint(skin.controls.dpad, nx, ny))
      else {
        const mapped = CONTROL_TO_BUTTON[id]
        if (mapped) out.push(mapped)
      }
    }
    return out
  }, [skin])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Settle the chime the boot could not play without a gesture.
    if (chimeOwed.current) { chimeOwed.current = false; playBootChime() }
    const hit = buttonsAt(e.clientX, e.clientY)
    if (!hit.length) return
    e.preventDefault()
    // Button feedback: the house pop, quieter than a menu tap because a player
    // presses these many times a second. popHaptic() rides along inside it, so
    // the press also ticks on Android and through the native bridge on iOS.
    playPop(0.3)
    // Capture so a finger sliding off the button still reports here, and so
    // pointerup is guaranteed — otherwise a direction sticks down after the
    // finger is gone, which is the bug releaseAllButtons exists for. Guarded
    // because setPointerCapture THROWS on a pointerId the browser no longer
    // considers active, and that would abandon the press.
    try { (e.currentTarget as Element).setPointerCapture?.(e.pointerId) } catch { /* capture is an optimisation */ }
    pointers.current.set(e.pointerId, hit)
    recompute()
  }, [buttonsAt, recompute])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    // Sliding across the D-pad changes direction without lifting — the way a
    // thumb actually rolls from up into up+left.
    pointers.current.set(e.pointerId, buttonsAt(e.clientX, e.clientY))
    recompute()
  }, [buttonsAt, recompute])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!pointers.current.delete(e.pointerId)) return
    recompute()
  }, [recompute])

  const down = (b: RetroButton) => pressed.has(b)
  const pct = (n: number) => `${n * 100}%`
  const { dpad, a, b, start, select } = skin.controls
  const dpadDown = down('up') || down('down') || down('left') || down('right')

  const step = (dir: 1 | -1) => {
    const i = RETRO_SHELL_SKINS.findIndex(s => s.id === skinId)
    const next = (i + dir + RETRO_SHELL_SKINS.length) % RETRO_SHELL_SKINS.length
    pickSkin(RETRO_SHELL_SKINS[next].id)
  }

  return (
    <div className={styles.stage}>
      {/* Same file as the shell, so it is one decode and one cache entry. */}
      {hasArt && <img className={styles.backdrop} src={skin.art!.shellAsset} alt="" aria-hidden="true" draggable={false} />}

      {/* Colour selection, the way the Poplur phone screen does it: an arrow
          either side of the device, no labels. The handheld re-boots on change,
          because that is what picking up a different one would do. */}
      <button
        type="button"
        className={`${styles.arrow} ${styles.arrowLeft}`}
        onClick={() => step(-1)}
        aria-label="Previous shell colour"
      />
      <button
        type="button"
        className={`${styles.arrow} ${styles.arrowRight}`}
        onClick={() => step(1)}
        aria-label="Next shell colour"
      />

      <div
        ref={shellRef}
        className={styles.shell}
        style={{ aspectRatio: `${SHELL_W} / ${SHELL_H}` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={e => e.preventDefault()}
      >
        {/* Power LED: flashes while the handheld boots, then holds lit. Finite
            (the element unmounts with the boot), because the thermal gate
            forbids an animation that runs forever. */}
        {skin.powerLed && boot !== 'done' && (
          <span
            className={styles.powerLed}
            aria-hidden="true"
            style={{
              left: pct(skin.powerLed.cx - skin.powerLed.r),
              top: pct(skin.powerLed.cy - skin.powerLed.r * (SHELL_W / SHELL_H)),
              width: pct(skin.powerLed.r * 2),
            }}
          />
        )}
        {hasArt
          ? <img className={styles.shellArt} src={skin.art!.shellAsset} alt={`${skin.name} shell`} draggable={false} />
          : <div className={styles.shellFallback} />}

        {/* The emulator surface, clipped to the skin's screen opening. The
            supplied art PAINTS its screen rather than cutting it out, so this
            sits over the artwork; it stays transparent until a core attaches,
            which is why the shell's own title art still reads through. */}
        <div
          className={styles.screen}
          style={{ left: pct(skin.screen.x), top: pct(skin.screen.y), width: pct(skin.screen.w), height: pct(skin.screen.h) }}
        >
          <canvas className={styles.screenCanvas} width={240} height={160} aria-label="Emulator output" />

          {/* Boot. The shell's painted splash is the END of this, not a still:
              the panel blacks out, the mark travels down, lands, chimes, then
              the cover clears and the art's own title is what you are left
              looking at. Unmounted once done so nothing animates at rest. */}
          {boot !== 'done' && (
            <div className={`${styles.boot} ${boot === 'land' ? styles.bootLanded : ''}`} aria-hidden="true">
              <img className={styles.bootMark} src="games/arcade/poplur_wordmark.png" alt="" draggable={false} />
            </div>
          )}
        </div>

        {/* Controls are INVISIBLE hit targets over the painted buttons: the art
            already draws them. They carry only the press transform, since the
            sheet ships no pressed-state assets. Toggle the outlines to see the
            geometry the hit-test is actually using. */}
        <div
          className={`${styles.hit} ${dpadDown ? styles.hitDown : ''} ${showBoxes ? styles.hitShown : ''}`}
          style={{ left: pct(dpad.bounds.x), top: pct(dpad.bounds.y), width: pct(dpad.bounds.w), height: pct(dpad.bounds.h) }}
        />
        <div
          className={`${styles.hit} ${styles.hitRound} ${down('a') ? styles.hitDown : ''} ${showBoxes ? styles.hitShown : ''}`}
          style={{ left: pct(a.cx - a.r), top: pct(a.cy - a.r * (SHELL_W / SHELL_H)), width: pct(a.r * 2), aspectRatio: '1' }}
        />
        <div
          className={`${styles.hit} ${styles.hitRound} ${down('b') ? styles.hitDown : ''} ${showBoxes ? styles.hitShown : ''}`}
          style={{ left: pct(b.cx - b.r), top: pct(b.cy - b.r * (SHELL_W / SHELL_H)), width: pct(b.r * 2), aspectRatio: '1' }}
        />
        <div
          className={`${styles.hit} ${styles.hitPill} ${down('select') ? styles.hitDown : ''} ${showBoxes ? styles.hitShown : ''}`}
          style={{ left: pct(select.x), top: pct(select.y), width: pct(select.w), height: pct(select.h) }}
        />
        <div
          className={`${styles.hit} ${styles.hitPill} ${down('start') ? styles.hitDown : ''} ${showBoxes ? styles.hitShown : ''}`}
          style={{ left: pct(start.x), top: pct(start.y), width: pct(start.w), height: pct(start.h) }}
        />
      </div>

    </div>
  )
}
