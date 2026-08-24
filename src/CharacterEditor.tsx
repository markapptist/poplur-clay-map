import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  readCharacter, saveCharacter,
  type BodyShape, type FaceStyle, type HairStyle, type PoplurCharacter,
} from './characterStore'
import { STUDIO_OPTIONS, studioInitialCharacter, type StudioCategory } from './AvatarStudioCharacter'
import ThreeAvatarStudio from './ThreeAvatarStudio'
import { WARDROBE_SCENE_SRC } from './characterParts'
import { playPop } from './pop'
import styles from './CharacterEditor.module.css'

const STYLE_CATEGORIES: { id: StudioCategory, label: string }[] = [
  { id: 'body', label: 'Body' },
  { id: 'hair', label: 'Hair' },
  { id: 'face', label: 'Face' },
  { id: 'top', label: 'Top' },
  { id: 'bottoms', label: 'Bottoms' },
  { id: 'extras', label: 'Extras' },
]

const CATEGORY_HINTS: Record<StudioCategory, string> = {
  body: 'Identity, build & skin', hair: 'Hair cut & colour', face: 'Face & eye colour',
  top: 'Top style & colour', bottoms: 'Bottom style & colour', extras: 'Finishing touches',
}

type OutfitSlot = 'top' | 'bottom' | 'accessory'
type CubePressBinder = (handler: (() => boolean) | null) => void

/** Full-screen, original local character creator. Every choice is rendered
    on-device; it does not require a paid avatar API. */
export default function CharacterEditor({ bindCubePress }: { bindCubePress?: CubePressBinder }) {
  const [character, setCharacter] = useState<PoplurCharacter>(() => studioInitialCharacter(readCharacter()))
  const characterRef = useRef(character)
  const [activeCategory, setActiveCategory] = useState<StudioCategory>('body')
  const [sceneReady, setSceneReady] = useState(false)
  const [studioOpen, setStudioOpen] = useState(false)

  const apply = useCallback((patch: Partial<PoplurCharacter>) => {
    playPop()
    setCharacter(current => {
      const next = studioInitialCharacter({ ...current, ...patch, updatedAt: Date.now() })
      characterRef.current = next
      return next
    })
  }, [])

  const setOutfitPart = useCallback((slot: OutfitSlot, id: string) => {
    playPop()
    setCharacter(current => {
      const next = studioInitialCharacter({ ...current, outfit: { ...current.outfit, [slot]: id }, updatedAt: Date.now() })
      characterRef.current = next
      return next
    })
  }, [])

  const reset = useCallback(() => {
    playPop()
    const next = studioInitialCharacter(null)
    characterRef.current = next
    setCharacter(next)
  }, [])

  const shuffle = useCallback(() => {
    playPop()
    setCharacter(current => {
      const pick = <T,>(choices: readonly T[]) => choices[Math.floor(Math.random() * choices.length)]
      const next = studioInitialCharacter({
        ...current,
        gender: pick(['male', 'female'] as const),
        skinTone: pick(STUDIO_OPTIONS.SKIN_TONES), hairColor: pick(STUDIO_OPTIONS.HAIR_COLORS),
        hairStyle: pick(STUDIO_OPTIONS.hairStyles), bodyShape: pick(STUDIO_OPTIONS.bodyShapes),
        faceStyle: pick(STUDIO_OPTIONS.faceStyles), eyeColor: pick(STUDIO_OPTIONS.EYE_COLORS),
        topColor: pick(STUDIO_OPTIONS.TOP_COLORS), bottomColor: pick(STUDIO_OPTIONS.BOTTOM_COLORS),
        outfit: {
          ...current.outfit, top: pick(['tee', 'hoodie', 'jacket'] as const),
          bottom: pick(['jeans', 'shorts', 'skirt'] as const), accessory: pick(['none', 'glasses', 'cap', 'chain'] as const),
        },
        updatedAt: Date.now(),
      })
      characterRef.current = next
      return next
    })
  }, [])

  const toggleStudioFromCube = useCallback(() => {
    if (studioOpen) {
      const next = studioInitialCharacter({ ...characterRef.current, updatedAt: Date.now() })
      characterRef.current = next
      saveCharacter(next)
      setCharacter(next)
      setStudioOpen(false)
      return true
    }
    const saved = studioInitialCharacter(readCharacter())
    characterRef.current = saved
    setCharacter(saved)
    setStudioOpen(true)
    return true
  }, [studioOpen])

  useEffect(() => {
    bindCubePress?.(toggleStudioFromCube)
    return () => bindCubePress?.(null)
  }, [bindCubePress, toggleStudioFromCube])

  return (
    <main className={styles.wardrobe} data-wardrobe-surface='poplur-fullscreen'>
      <div className={styles.roomFallback} aria-hidden='true' />
      <img src={WARDROBE_SCENE_SRC} alt='' className={sceneReady ? styles.roomBlurReady : styles.roomBlur} draggable={false} aria-hidden='true' />
      <img src={WARDROBE_SCENE_SRC} alt='Your Poplur wardrobe room' className={sceneReady ? styles.roomArtReady : styles.roomArt} draggable={false} onLoad={() => setSceneReady(true)} onError={event => { setSceneReady(false); event.currentTarget.style.display = 'none' }} />
      <div className={styles.roomLight} aria-hidden='true' />

      <div className={styles.characterStage}>
        <ThreeAvatarStudio character={character} mode='3d' />
        <span className={styles.characterShadow} aria-hidden='true' />
      </div>

      {studioOpen && <aside className={styles.studioPopup} aria-label='Character studio'>
      <section className={styles.styleDock} aria-label='Build your character'>
        <div className={styles.dockHeading}>
          <strong>Character studio</strong>
          <div className={styles.dockActions}>
            <button type='button' className={styles.shuffleButton} onClick={shuffle}>Shuffle</button>
            <button type='button' className={styles.resetButton} onClick={reset}>Reset</button>
          </div>
        </div>

        <div className={styles.categoryRail} role='tablist' aria-label='Character customisation categories'>
          {STYLE_CATEGORIES.map(category => (
            <button key={category.id} type='button' role='tab' aria-selected={activeCategory === category.id} className={activeCategory === category.id ? styles.categoryActive : styles.category} onClick={() => { playPop(); setActiveCategory(category.id) }}>
              {category.label}
            </button>
          ))}
        </div>

        <div className={styles.optionRail} role='tabpanel' aria-label={CATEGORY_HINTS[activeCategory]}>
          {activeCategory === 'body' && <>
            <StyleChoice label='Female' glyph='♀' active={character.gender === 'female'} onPick={() => apply({ gender: 'female' })} />
            <StyleChoice label='Male' glyph='♂' active={character.gender === 'male'} onPick={() => apply({ gender: 'male' })} />
            {STUDIO_OPTIONS.bodyShapes.map(shape => <StyleChoice key={shape} label={title(shape)} active={character.bodyShape === shape} onPick={() => apply({ bodyShape: shape as BodyShape })} />)}
            {STUDIO_OPTIONS.SKIN_TONES.map(color => <ColorChoice key={color} color={color} active={character.skinTone === color} onPick={() => apply({ skinTone: color })} />)}
          </>}
          {activeCategory === 'hair' && <>
            {STUDIO_OPTIONS.hairStyles.map(style => <StyleChoice key={style} label={title(style)} active={character.hairStyle === style} onPick={() => apply({ hairStyle: style as HairStyle })} />)}
            {STUDIO_OPTIONS.HAIR_COLORS.map(color => <ColorChoice key={color} color={color} active={character.hairColor === color} onPick={() => apply({ hairColor: color })} />)}
          </>}
          {activeCategory === 'face' && <>
            {STUDIO_OPTIONS.faceStyles.map(style => <StyleChoice key={style} label={title(style)} active={character.faceStyle === style} onPick={() => apply({ faceStyle: style as FaceStyle })} />)}
            {STUDIO_OPTIONS.EYE_COLORS.map(color => <ColorChoice key={color} color={color} active={character.eyeColor === color} onPick={() => apply({ eyeColor: color })} />)}
          </>}
          {activeCategory === 'top' && <>
            {['tee', 'hoodie', 'jacket'].map(style => <StyleChoice key={style} label={title(style)} active={character.outfit?.top === style} onPick={() => setOutfitPart('top', style)} />)}
            {STUDIO_OPTIONS.TOP_COLORS.map(color => <ColorChoice key={color} color={color} active={character.topColor === color} onPick={() => apply({ topColor: color })} />)}
          </>}
          {activeCategory === 'bottoms' && <>
            {['jeans', 'shorts', 'skirt'].map(style => <StyleChoice key={style} label={title(style)} active={character.outfit?.bottom === style} onPick={() => setOutfitPart('bottom', style)} />)}
            {STUDIO_OPTIONS.BOTTOM_COLORS.map(color => <ColorChoice key={color} color={color} active={character.bottomColor === color} onPick={() => apply({ bottomColor: color })} />)}
          </>}
          {activeCategory === 'extras' && <>
            <StyleChoice label='None' glyph='—' active={character.outfit?.accessory === 'none'} onPick={() => setOutfitPart('accessory', 'none')} />
            <StyleChoice label='Glasses' glyph='⌐' active={character.outfit?.accessory === 'glasses'} onPick={() => setOutfitPart('accessory', 'glasses')} />
            <StyleChoice label='Cap' glyph='⌒' active={character.outfit?.accessory === 'cap'} onPick={() => setOutfitPart('accessory', 'cap')} />
            <StyleChoice label='Chain' glyph='◆' active={character.outfit?.accessory === 'chain'} onPick={() => setOutfitPart('accessory', 'chain')} />
          </>}
        </div>
      </section>
      <div className={styles.studioScaleControls} aria-label='Character size controls'>
        <div className={styles.avatarHeightControl}>
          <ScaleKnobControl label='Height' value={character.heightScale ?? 0.95} vertical onChange={value => apply({ heightScale: value })} />
        </div>
        <div className={styles.avatarStatureControl}>
          <ScaleKnobControl label='Stature' value={character.statureScale ?? 0.96} onChange={value => apply({ statureScale: value })} />
        </div>
      </div>
      <span className={`${styles.scaleExteriorLabel} ${styles.heightExteriorLabel}`} aria-hidden='true'>Height</span>
      <span className={`${styles.scaleExteriorLabel} ${styles.statureExteriorLabel}`} aria-hidden='true'>Stature</span>
      </aside>}
    </main>
  )
}

function title(value: string) { return value.slice(0, 1).toUpperCase() + value.slice(1) }

function ColorChoice({ color, active, onPick }: { color: string, active: boolean, onPick: () => void }) {
  return <button type='button' className={active ? styles.colorChoiceActive : styles.colorChoice} style={{ '--choice-color': color } as React.CSSProperties} onClick={onPick} aria-label={`Colour ${color}`} aria-pressed={active}><span aria-hidden='true' /></button>
}

function StyleChoice({ label, glyph, active, onPick }: { label: string, glyph?: string, active: boolean, onPick: () => void }) {
  return <button type='button' className={active ? styles.layerChoiceActive : styles.layerChoice} onClick={onPick} aria-pressed={active}><span className={styles.choiceGlyph} aria-hidden='true'>{glyph ?? label.slice(0, 1)}</span><small>{label}</small></button>
}

const HEIGHT_STEPS = [0.84, 0.9, 0.96, 1] as const
const STATURE_STEPS = [0.82, 0.94, 1.06, 1.18] as const
const SCALE_LABELS = ['S', 'M', 'L', 'XL'] as const

function ScaleKnobControl({ label, value, vertical = false, onChange }: { label: string, value: number, vertical?: boolean, onChange: (value: number) => void }) {
  const steps = label === 'Height' ? HEIGHT_STEPS : STATURE_STEPS
  const active = steps.reduce((closest, step, index) => Math.abs(step - value) < Math.abs(steps[closest] - value) ? index : closest, 0)
  const updateFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = vertical
      ? 1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
      : Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    onChange(steps[Math.round(ratio * (steps.length - 1))])
  }
  const updateFromKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? steps.length - 1 : Math.max(0, Math.min(steps.length - 1, active + delta))
    onChange(steps[next])
  }
  return <div className={vertical ? styles.scaleControlVertical : styles.scaleControl} role='group' aria-label={`${label} control`}>
    <div className={styles.scaleRail} role='slider' tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={3} aria-valuenow={active} aria-valuetext={SCALE_LABELS[active]} style={{ '--scale-progress': `${active / (steps.length - 1) * 100}%`, '--scale-position': `${active / (steps.length - 1) * 100}%` } as React.CSSProperties} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); updateFromPointer(event) }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event) }} onKeyDown={updateFromKey}>
      <span className={styles.scaleThumb} aria-hidden='true'>{SCALE_LABELS[active]}</span>
    </div>
  </div>
}
