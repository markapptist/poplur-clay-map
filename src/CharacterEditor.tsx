import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  readCharacter, saveCharacter, clearCharacter,
  SKIN_TONES, HAIR_COLORS, HAIR_STYLES, EYE_COLORS, TOP_COLORS, BOTTOM_COLORS,
  type PoplurCharacter, type HairStyle,
} from './characterStore'
import ReferenceWardrobeCharacter, {
  referenceWardrobeCharacter,
  wardrobeInitialCharacter,
} from './ReferenceWardrobeCharacter'
import { MANIFEST, WARDROBE_SCENE_SRC, type PartSlot } from './characterParts'
import { playPop } from './pop'
import { setPopupsSuppressed } from './popups'
import styles from './CharacterEditor.module.css'

const WardrobeBuilder = lazy(() => import('./wardrobe/WardrobeBuilder'))

const OUTFIT_RACKS: { slot: PartSlot, label: string }[] = [
  { slot: 'top', label: 'Tops' },
  { slot: 'bottom', label: 'Bottoms' },
  { slot: 'shoes', label: 'Shoes' },
  { slot: 'hairFront', label: 'Hair' },
  { slot: 'glasses', label: 'Glasses' },
  { slot: 'accessory', label: 'Accessories' },
]

// The wardrobe. This wrapped Ready Player Me's iframe until Netflix shut the
// service down (31 Jan 2026, every *.readyplayer.me host gone) — the editor
// is in-house now: the shared ClayCharacter drawing in the middle of the
// closet, racks of swatches around it, every change saved as it is made.
export default function CharacterEditor() {
  const [character, setCharacter] = useState<PoplurCharacter>(
    // Wardrobe owns this visual seed; global defaults elsewhere in Poplur
    // remain the familiar neutral male character.
    () => wardrobeInitialCharacter(readCharacter()),
  )
  const [buildingCloset, setBuildingCloset] = useState(false)
  const [builderPortalRoot, setBuilderPortalRoot] = useState<HTMLElement | null>(null)
  const builderLaunchRef = useRef<HTMLButtonElement | null>(null)
  const restoreLaunchFocusRef = useRef(false)
  // The supplied wardrobe render carries its own closet, rail, rug — and for
  // now its own resident character. While it loads, the CSS furniture and the
  // SVG stand-in step aside; if it is missing (Vite 200s missing public files
  // as text/html, so onError is the real detector) the CSS closet is the room.
  const [sceneReady, setSceneReady] = useState(false)

  useEffect(() => {
    if (!buildingCloset) return
    setPopupsSuppressed(true)
    if (typeof document !== 'undefined') document.body.dataset.wardrobeBuilderOpen = 'true'
    return () => {
      setPopupsSuppressed(false)
      if (typeof document !== 'undefined') delete document.body.dataset.wardrobeBuilderOpen
    }
  }, [buildingCloset])

  useEffect(() => {
    if (buildingCloset || !restoreLaunchFocusRef.current) return
    restoreLaunchFocusRef.current = false
    builderLaunchRef.current?.focus()
  }, [buildingCloset])

  const apply = useCallback((patch: Partial<PoplurCharacter>) => {
    playPop()
    setCharacter(current => {
      const next = { ...current, ...patch, updatedAt: Date.now() }
      saveCharacter(next)
      return next
    })
  }, [])

  const reset = useCallback(() => {
    playPop()
    clearCharacter()
    setCharacter(referenceWardrobeCharacter())
  }, [])

  const closeBuilder = useCallback(() => {
    restoreLaunchFocusRef.current = true
    setBuildingCloset(false)
    setBuilderPortalRoot(null)
  }, [])

  if (buildingCloset && typeof document !== 'undefined') {
    return createPortal(
      <div className={styles.builderHost} data-wardrobe-builder-modal='true' role='region' aria-label='Closet designer'>
        <Suspense fallback={<div className={styles.builderLoading}>Opening closet builder…</div>}>
          <WardrobeBuilder character={character} onClose={closeBuilder} />
        </Suspense>
      </div>,
      builderPortalRoot ?? document.body,
    )
  }

  return (
    <div className={styles.wardrobe}>
      {!sceneReady && (
        <div className={styles.doorLeft}>
          <div className={styles.doorPanel} />
          <div className={styles.doorPanel} />
          <div className={styles.doorPanel} />
          <div className={styles.doorKnob} />
        </div>
      )}

      <div className={styles.closetInterior}>
        {/* The wardrobe room render (public/character/wardrobe-room.png,
            supplied art — see characterParts.ts). Until it exists the dark
            closet CSS behind it is the room; Vite 200s missing public files
            as text/html, so onError is what actually detects absence. */}
        <img
          src={WARDROBE_SCENE_SRC}
          alt=""
          className={styles.sceneArt}
          draggable={false}
          onLoad={() => setSceneReady(true)}
          onError={event => {
            setSceneReady(false)
            event.currentTarget.style.display = 'none'
          }}
        />
        <div className={styles.editorToolbar}>
          <div className={styles.editorToolbarCopy}>
            <strong>My wardrobe</strong>
            <span>Style your character or design the whole closet.</span>
          </div>
          <button
            ref={builderLaunchRef}
            type="button"
            className={styles.builderLaunch}
            onClick={event => {
              playPop()
              setBuilderPortalRoot(
                event.currentTarget.closest<HTMLElement>('[role="dialog"]')
                ?? event.currentTarget.closest('section')
                ?? event.currentTarget.closest('main')
                ?? document.body,
              )
              setBuildingCloset(true)
            }}
          >
            Design closet
          </button>
        </div>
        {/* Clothes rail — hanging tees ARE the top-colour picker. The scene
            render has a painted rail of its own, so this one only exists in
            the CSS closet. */}
        {!sceneReady && (
          <div className={styles.clothesRail}>
            <div className={styles.rail} />
            {TOP_COLORS.map((color, i) => (
              <button
                key={color}
                type="button"
                className={character.topColor === color ? styles.hangerTeeActive : styles.hangerTee}
                style={{ left: `${8 + i * (84 / TOP_COLORS.length)}%` }}
                onClick={() => apply({ topColor: color })}
                aria-label={`Top colour ${i + 1}`}
              >
                <svg width="26" height="30" viewBox="0 0 26 30">
                  <path d="M13 0 L13 4" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
                  <path d="M5 8 L9 5 L13 7 L17 5 L21 8 L18 12 L18 26 L8 26 L8 12Z" fill={color} stroke="rgba(0,0,0,0.25)" strokeWidth="0.75" />
                </svg>
              </button>
            ))}
          </div>
        )}

        {/* The character, standing in the closet. The scene render is the
            EMPTY closet (sliced from the supplied parts-pack sheet), so the
            character composites over its rug; in the CSS closet she stands
            on the CSS rug instead. */}
        {!sceneReady && (
          <div className={styles.stage}>
            <ReferenceWardrobeCharacter character={character} height={230} />
            <div className={styles.floorShadow} />
          </div>
        )}
        {sceneReady && (
          <div className={styles.sceneCharacter} aria-hidden="true">
            <ReferenceWardrobeCharacter character={character} height={260} />
          </div>
        )}
        {sceneReady && <div className={styles.sceneSpacer} />}

        {/* Racks — one row per attribute */}
        <div className={styles.racks}>
          {sceneReady && (
            <Rack label="Top">
              {TOP_COLORS.map(color => (
                <Swatch key={color} color={color} active={character.topColor === color} onPick={() => apply({ topColor: color })} />
              ))}
            </Rack>
          )}
          <Rack label="Body">
            <button
              type="button"
              className={character.gender === 'male' ? styles.pillActive : styles.pill}
              onClick={() => apply({ gender: 'male' })}
            >Male</button>
            <button
              type="button"
              className={character.gender === 'female' ? styles.pillActive : styles.pill}
              onClick={() => apply({ gender: 'female' })}
            >Female</button>
          </Rack>
          <Rack label="Skin">
            {SKIN_TONES.map(color => (
              <Swatch key={color} color={color} active={character.skinTone === color} onPick={() => apply({ skinTone: color })} />
            ))}
          </Rack>
          <Rack label="Hair">
            {HAIR_STYLES.map(style => (
              <button
                key={style}
                type="button"
                className={character.hairStyle === style ? styles.pillActive : styles.pill}
                onClick={() => apply({ hairStyle: style as HairStyle })}
              >{style}</button>
            ))}
          </Rack>
          <Rack label="Hair colour">
            {HAIR_COLORS.map(color => (
              <Swatch key={color} color={color} active={character.hairColor === color} onPick={() => apply({ hairColor: color })} />
            ))}
          </Rack>
          <Rack label="Eyes">
            {EYE_COLORS.map(color => (
              <Swatch key={color} color={color} active={character.eyeColor === color} onPick={() => apply({ eyeColor: color })} />
            ))}
          </Rack>
          <Rack label="Bottoms">
            {BOTTOM_COLORS.map(color => (
              <Swatch key={color} color={color} active={character.bottomColor === color} onPick={() => apply({ bottomColor: color })} />
            ))}
          </Rack>
          {/* Part-art racks appear per slot as the library fills (see
              characterParts.ts MANIFEST); an empty slot shows nothing. */}
          {OUTFIT_RACKS.map(({ slot, label }) => MANIFEST[slot].length > 0 && (
            <Rack key={slot} label={label}>
              {MANIFEST[slot].map(part => (
                <button
                  key={part.id}
                  type="button"
                  className={(character.outfit?.[slot] ?? MANIFEST[slot][0].id) === part.id ? styles.partActive : styles.part}
                  onClick={() => apply({ outfit: { ...character.outfit, [slot]: part.id } })}
                >
                  <img src={`character/${slot}/${part.file}`} alt={part.label} draggable={false} />
                </button>
              ))}
            </Rack>
          ))}
          <button type="button" className={styles.resetBtn} onClick={reset}>Reset character</button>
        </div>
      </div>

      {!sceneReady && (
        <div className={styles.doorRight}>
          <div className={styles.doorPanel} />
          <div className={styles.doorPanel} />
          <div className={styles.doorPanel} />
          <div className={styles.doorKnob} />
        </div>
      )}
    </div>
  )
}

function Rack({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div className={styles.rack}>
      <span className={styles.rackLabel}>{label}</span>
      <div className={styles.rackItems}>{children}</div>
    </div>
  )
}

function Swatch({ color, active, onPick }: { color: string, active: boolean, onPick: () => void }) {
  return (
    <button
      type="button"
      className={active ? styles.swatchActive : styles.swatch}
      style={{ background: color }}
      onClick={onPick}
      aria-label={`Colour ${color}`}
      aria-pressed={active}
    />
  )
}
