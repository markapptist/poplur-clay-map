import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  readCharacter, saveCharacter, clearCharacter,
  HAIR_COLORS, EYE_COLORS, TOP_COLORS, BOTTOM_COLORS,
  type PoplurCharacter,
} from './characterStore'
import ReferenceWardrobeCharacter, {
  REFERENCE_WARDROBE_ASSETS,
  referenceWardrobeCharacter,
  wardrobeInitialCharacter,
} from './ReferenceWardrobeCharacter'
import { WARDROBE_SCENE_SRC } from './characterParts'
import { playPop } from './pop'
import { setPopupsSuppressed } from './popups'
import styles from './CharacterEditor.module.css'

const WardrobeBuilder = lazy(() => import('./wardrobe/WardrobeBuilder'))

type StyleCategory = 'hair' | 'eyes' | 'top' | 'bottoms' | 'glasses'

const STYLE_CATEGORIES: { id: StyleCategory, label: string }[] = [
  { id: 'hair', label: 'Hair' },
  { id: 'eyes', label: 'Eyes' },
  { id: 'top', label: 'Top' },
  { id: 'bottoms', label: 'Bottoms' },
  { id: 'glasses', label: 'Glasses' },
]

const CATEGORY_HINTS: Record<StyleCategory, string> = {
  hair: 'Long ponytail',
  eyes: 'Eye colour',
  top: 'Bandeau colour',
  bottoms: 'Shorts colour',
  glasses: 'Face accessory',
}

/** Full-screen Poplur wardrobe. The resident is always the supplied character;
    only edits backed by that authored character canvas are offered here. */
export default function CharacterEditor() {
  const [character, setCharacter] = useState<PoplurCharacter>(() => wardrobeInitialCharacter(readCharacter()))
  const [activeCategory, setActiveCategory] = useState<StyleCategory>('hair')
  const [buildingCloset, setBuildingCloset] = useState(false)
  const [builderPortalRoot, setBuilderPortalRoot] = useState<HTMLElement | null>(null)
  const builderLaunchRef = useRef<HTMLButtonElement | null>(null)
  const restoreLaunchFocusRef = useRef(false)
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
      const next = wardrobeInitialCharacter({ ...current, ...patch, updatedAt: Date.now() })
      saveCharacter(next)
      return next
    })
  }, [])

  const setOutfitPart = useCallback((slot: 'hairFront' | 'glasses', id: string) => {
    setCharacter(current => {
      playPop()
      const next = wardrobeInitialCharacter({
        ...current,
        outfit: { ...current.outfit, [slot]: id },
        updatedAt: Date.now(),
      })
      saveCharacter(next)
      return next
    })
  }, [])

  const reset = useCallback(() => {
    playPop()
    clearCharacter()
    const next = referenceWardrobeCharacter()
    saveCharacter(next)
    setCharacter(next)
  }, [])

  const closeBuilder = useCallback(() => {
    restoreLaunchFocusRef.current = true
    setBuildingCloset(false)
    setBuilderPortalRoot(null)
  }, [])

  if (buildingCloset && typeof document !== 'undefined') {
    return createPortal(
      <div className={styles.builderHost} data-wardrobe-builder-modal='true' role='region' aria-label='Closet designer'>
        <Suspense fallback={<div className={styles.builderLoading}>Opening your room…</div>}>
          <WardrobeBuilder character={character} onClose={closeBuilder} />
        </Suspense>
      </div>,
      builderPortalRoot ?? document.body,
    )
  }

  const hairVisible = character.outfit?.hairFront !== 'none'
  const glassesVisible = character.outfit?.glasses !== 'none'

  return (
    <main className={styles.wardrobe} data-wardrobe-surface='poplur-fullscreen'>
      <div className={styles.roomFallback} aria-hidden='true' />
      <img
        src={WARDROBE_SCENE_SRC}
        alt=''
        className={sceneReady ? styles.roomBlurReady : styles.roomBlur}
        draggable={false}
        aria-hidden='true'
      />
      <img
        src={WARDROBE_SCENE_SRC}
        alt='Your Poplur wardrobe room'
        className={sceneReady ? styles.roomArtReady : styles.roomArt}
        draggable={false}
        onLoad={() => setSceneReady(true)}
        onError={event => {
          setSceneReady(false)
          event.currentTarget.style.display = 'none'
        }}
      />
      <div className={styles.roomLight} aria-hidden='true' />

      <button
        ref={builderLaunchRef}
        type='button'
        className={styles.roomButton}
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
        aria-label='Design the wardrobe room'
      >
        <RoomIcon />
        <span>Room</span>
      </button>

      <div className={styles.characterStage}>
        <ReferenceWardrobeCharacter character={character} height={420} />
        <span className={styles.characterShadow} aria-hidden='true' />
      </div>

      <section className={styles.styleDock} aria-label='Style your character'>
        <div className={styles.dockHeading}>
          <div>
            <strong>Style</strong>
            <span>{CATEGORY_HINTS[activeCategory]}</span>
          </div>
          <button type='button' className={styles.resetButton} onClick={reset}>Reset</button>
        </div>

        <div className={styles.categoryRail} role='tablist' aria-label='Character style categories'>
          {STYLE_CATEGORIES.map(category => (
            <button
              key={category.id}
              type='button'
              role='tab'
              aria-selected={activeCategory === category.id}
              className={activeCategory === category.id ? styles.categoryActive : styles.category}
              onClick={() => {
                playPop()
                setActiveCategory(category.id)
              }}
            >
              {category.label}
            </button>
          ))}
        </div>

        <div className={styles.optionRail} role='tabpanel' aria-label={CATEGORY_HINTS[activeCategory]}>
          {activeCategory === 'hair' && (
            <>
              <LayerChoice label='No hair' active={!hairVisible} onPick={() => setOutfitPart('hairFront', 'none')} />
              <LayerChoice
                label='Long'
                active={hairVisible}
                image={REFERENCE_WARDROBE_ASSETS.hair}
                onPick={() => setOutfitPart('hairFront', 'reference-long-hair')}
              />
              {HAIR_COLORS.map(color => (
                <ColorChoice key={color} color={color} active={hairVisible && character.hairColor === color} onPick={() => {
                  if (!hairVisible) setOutfitPart('hairFront', 'reference-long-hair')
                  apply({ hairColor: color })
                }} />
              ))}
            </>
          )}
          {activeCategory === 'eyes' && EYE_COLORS.map(color => (
            <ColorChoice key={color} color={color} active={character.eyeColor === color} onPick={() => apply({ eyeColor: color })} />
          ))}
          {activeCategory === 'top' && TOP_COLORS.map(color => (
            <ColorChoice key={color} color={color} active={character.topColor === color} onPick={() => apply({ topColor: color })} />
          ))}
          {activeCategory === 'bottoms' && BOTTOM_COLORS.map(color => (
            <ColorChoice key={color} color={color} active={character.bottomColor === color} onPick={() => apply({ bottomColor: color })} />
          ))}
          {activeCategory === 'glasses' && (
            <>
              <LayerChoice label='None' active={!glassesVisible} onPick={() => setOutfitPart('glasses', 'none')} />
              <LayerChoice
                label='Black'
                active={glassesVisible}
                image={REFERENCE_WARDROBE_ASSETS.glasses}
                onPick={() => setOutfitPart('glasses', 'reference-black-glasses')}
              />
            </>
          )}
        </div>
      </section>
    </main>
  )
}

function ColorChoice({ color, active, onPick }: { color: string, active: boolean, onPick: () => void }) {
  return (
    <button
      type='button'
      className={active ? styles.colorChoiceActive : styles.colorChoice}
      style={{ '--choice-color': color } as React.CSSProperties}
      onClick={onPick}
      aria-label={`Colour ${color}`}
      aria-pressed={active}
    >
      <span aria-hidden='true' />
    </button>
  )
}

function LayerChoice({ label, active, image, onPick }: {
  label: string
  active: boolean
  image?: string
  onPick: () => void
}) {
  return (
    <button type='button' className={active ? styles.layerChoiceActive : styles.layerChoice} onClick={onPick} aria-pressed={active}>
      {image ? <img src={image} alt='' draggable={false} aria-hidden='true' /> : <span className={styles.noneMark} aria-hidden='true' />}
      <small>{label}</small>
    </button>
  )
}

function RoomIcon() {
  return (
    <svg width='18' height='18' viewBox='0 0 18 18' aria-hidden='true'>
      <path d='M3 3.4h12v11.2H3zM9 3.4v11.2M5.3 6.1h1.5M11.2 6.1h1.5' fill='none' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round' strokeLinejoin='round' />
    </svg>
  )
}
