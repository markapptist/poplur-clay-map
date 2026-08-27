import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  readCharacter, saveCharacter,
  type BodyShape, type FaceStyle, type HairStyle, type PoplurCharacter,
} from './characterStore'
import { STUDIO_OPTIONS, studioInitialCharacter, type StudioCategory } from './AvatarStudioCharacter'
import ThreeAvatarStudio from './ThreeAvatarStudio'
import FittedAvatarWardrobe from './FittedAvatarWardrobe'
import { readSavedAvaturnAvatar } from './avaturnAvatarStore'
import { WARDROBE_SCENE_SRC } from './characterParts'
import {
  ACCESSORY_FASHION_STYLES,
  BOTTOM_FASHION_STYLES,
  TOP_FASHION_STYLES,
  type FashionSlot,
  type FashionStyle,
  type FashionStyleIdBySlot,
} from './characterFashion'
import { loadWardrobeCatalog, type RemoteWardrobeStyles } from './wardrobeGarmentApi'
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
  top: 'Everyday and Poplur Atelier tops', bottoms: 'Everyday and Poplur Atelier bottoms',
  extras: 'Accessories and runway finishing touches',
}

type CubePressBinder = (handler: (() => boolean) | null) => void

/** Full-screen, original local character creator. Every choice is rendered
    on-device; it does not require a paid avatar API. */
export default function CharacterEditor({ bindCubePress }: { bindCubePress?: CubePressBinder }) {
  const wardrobeRef = useRef<HTMLElement | null>(null)
  const studioPopupRef = useRef<HTMLElement | null>(null)
  const studioDragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    baseX: number
    baseY: number
    popupRect: DOMRect
    stageRect: DOMRect
  } | null>(null)
  const [character, setCharacter] = useState<PoplurCharacter>(() => studioInitialCharacter(readCharacter()))
  const characterRef = useRef(character)
  const [activeCategory, setActiveCategory] = useState<StudioCategory>('body')
  const [sceneReady, setSceneReady] = useState(false)
  const [remoteFashion, setRemoteFashion] = useState<RemoteWardrobeStyles>({ top: [], bottom: [] })
  const [wardrobeProvider, setWardrobeProvider] = useState<'avaturn' | 'poplur'>(() => {
    try {
      const saved = localStorage.getItem('poplur.wardrobe.provider.v1')
      // Avaturn is an optional fitted-avatar provider, not the Wardrobe's sign-
      // in wall. Preserve it only after the person has actually saved an export;
      // everyone else opens directly into the local Poplur wardrobe.
      return saved === 'avaturn' && readSavedAvaturnAvatar() ? 'avaturn' : 'poplur'
    } catch { return 'poplur' }
  })
  // Wardrobe opens ready to dress the character. The cube still toggles the
  // studio and saves on close, but users no longer arrive at an inert model.
  const [studioOpen, setStudioOpen] = useState(true)
  const [studioOffset, setStudioOffset] = useState({ x: 0, y: 0 })

  const chooseWardrobeProvider = useCallback((provider: 'avaturn' | 'poplur') => {
    setWardrobeProvider(provider)
    try { localStorage.setItem('poplur.wardrobe.provider.v1', provider) } catch { /* private browsing */ }
  }, [])

  const beginStudioDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return
    const popup = studioPopupRef.current
    const stage = wardrobeRef.current
    if (!popup || !stage) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    studioDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: studioOffset.x,
      baseY: studioOffset.y,
      popupRect: popup.getBoundingClientRect(),
      stageRect: stage.getBoundingClientRect(),
    }
  }, [studioOffset])

  const moveStudioDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = studioDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    const inset = 8
    const minX = drag.baseX + drag.stageRect.left + inset - drag.popupRect.left
    const maxX = drag.baseX + drag.stageRect.right - inset - drag.popupRect.right
    const minY = drag.baseY + drag.stageRect.top + inset - drag.popupRect.top
    const maxY = drag.baseY + drag.stageRect.bottom - inset - drag.popupRect.bottom
    setStudioOffset({
      x: Math.max(Math.min(minX, maxX), Math.min(Math.max(minX, maxX), drag.baseX + dx)),
      y: Math.max(Math.min(minY, maxY), Math.min(Math.max(minY, maxY), drag.baseY + dy)),
    })
  }, [])

  const endStudioDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (studioDragRef.current?.pointerId !== event.pointerId) return
    studioDragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }, [])

  const apply = useCallback((patch: Partial<PoplurCharacter>) => {
    playPop()
    setCharacter(current => {
      const next = studioInitialCharacter({ ...current, ...patch, updatedAt: Date.now() })
      characterRef.current = next
      saveCharacter(next)
      return next
    })
  }, [])

  const setOutfitPart = useCallback(<Slot extends FashionSlot,>(slot: Slot, id: FashionStyleIdBySlot[Slot]) => {
    playPop()
    setCharacter(current => {
      const next = studioInitialCharacter({ ...current, fashionOutfit: { ...current.fashionOutfit, [slot]: id }, updatedAt: Date.now() })
      characterRef.current = next
      saveCharacter(next)
      return next
    })
  }, [])

  const reset = useCallback(() => {
    playPop()
    const next = studioInitialCharacter(null)
    characterRef.current = next
    saveCharacter(next)
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
        fashionOutfit: {
          ...current.fashionOutfit, top: pick(TOP_FASHION_STYLES).id,
          bottom: pick(BOTTOM_FASHION_STYLES).id, accessory: pick(ACCESSORY_FASHION_STYLES).id,
        },
        updatedAt: Date.now(),
      })
      characterRef.current = next
      saveCharacter(next)
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

  useEffect(() => {
    const controller = new AbortController()
    // Catalog discovery is intentionally non-blocking. The room and current
    // character appear first; fitted garments are added when Poplur's API is
    // reachable, without starting another renderer or reloading the body.
    void loadWardrobeCatalog(controller.signal).then(styles => {
      if (!controller.signal.aborted) setRemoteFashion(styles)
    })
    return () => controller.abort()
  }, [])

  const topFashionStyles: readonly FashionStyle[] = [...TOP_FASHION_STYLES, ...remoteFashion.top]
  const bottomFashionStyles: readonly FashionStyle[] = [...BOTTOM_FASHION_STYLES, ...remoteFashion.bottom]

  return (
    <main ref={wardrobeRef} className={styles.wardrobe} data-wardrobe-surface='poplur-fullscreen'>
      <div className={styles.roomFallback} aria-hidden='true' />
      <img src={WARDROBE_SCENE_SRC} alt='' className={sceneReady ? styles.roomBlurReady : styles.roomBlur} draggable={false} aria-hidden='true' />
      <img src={WARDROBE_SCENE_SRC} alt='Your Poplur wardrobe room' className={sceneReady ? styles.roomArtReady : styles.roomArt} draggable={false} onLoad={() => setSceneReady(true)} onError={event => { setSceneReady(false); event.currentTarget.style.display = 'none' }} />
      <div className={styles.roomLight} aria-hidden='true' />

      {wardrobeProvider === 'avaturn' && <FittedAvatarWardrobe onUseClassic={() => chooseWardrobeProvider('poplur')} />}

      {wardrobeProvider === 'poplur' && <><div className={styles.characterStage}>
        <ThreeAvatarStudio character={character} mode='3d' remoteFashion={remoteFashion} />
        <span className={styles.characterShadow} aria-hidden='true' />
      </div>

      <button type='button' className={styles.fittedWardrobeButton} onClick={() => chooseWardrobeProvider('avaturn')}>
        <strong>Fitted wardrobe</strong><small>Free avatar fitting</small>
      </button>

      {studioOpen && <div className={styles.studioLayout}>
      <aside
        ref={studioPopupRef}
        className={styles.studioPopup}
        aria-label='Character studio'
        style={{ '--studio-x': `${studioOffset.x}px`, '--studio-y': `${studioOffset.y}px` } as React.CSSProperties}
      >
      <section className={styles.styleDock} aria-label='Build your character'>
        <div
          className={styles.dockHeading}
          onPointerDown={beginStudioDrag}
          onPointerMove={moveStudioDrag}
          onPointerUp={endStudioDrag}
          onPointerCancel={endStudioDrag}
        >
          <strong><span className={styles.dragGrip} aria-hidden='true'>⠿</span> Character studio</strong>
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
            {topFashionStyles.map(style => <FashionChoice key={style.id} style={style} active={character.fashionOutfit?.top === style.id} onPick={() => setOutfitPart('top', style.id)} />)}
            {STUDIO_OPTIONS.TOP_COLORS.map(color => <ColorChoice key={color} color={color} active={character.topColor === color} onPick={() => apply({ topColor: color })} />)}
          </>}
          {activeCategory === 'bottoms' && <>
            {bottomFashionStyles.map(style => <FashionChoice key={style.id} style={style} active={character.fashionOutfit?.bottom === style.id} onPick={() => setOutfitPart('bottom', style.id)} />)}
            {STUDIO_OPTIONS.BOTTOM_COLORS.map(color => <ColorChoice key={color} color={color} active={character.bottomColor === color} onPick={() => apply({ bottomColor: color })} />)}
          </>}
          {activeCategory === 'extras' && <>
            {ACCESSORY_FASHION_STYLES.map(style => <FashionChoice key={style.id} style={style} active={character.fashionOutfit?.accessory === style.id} onPick={() => setOutfitPart('accessory', style.id)} />)}
          </>}
        </div>
      </section>
      </aside>
      <div className={styles.avatarHeightControl} aria-label='Character height control'>
        <ScaleKnobControl label='Height' value={character.heightScale ?? 0.95} vertical onChange={value => apply({ heightScale: value })} />
      </div>
      <div className={styles.avatarStatureControl} aria-label='Character stature control'>
        <ScaleKnobControl label='Stature' value={character.statureScale ?? 0.96} onChange={value => apply({ statureScale: value })} />
      </div>
      </div>}</>}
    </main>
  )
}

function title(value: string) { return value.slice(0, 1).toUpperCase() + value.slice(1) }

function ColorChoice({ color, active, onPick }: { color: string, active: boolean, onPick: () => void }) {
  return <button type='button' className={active ? styles.colorChoiceActive : styles.colorChoice} style={{ '--choice-color': color } as React.CSSProperties} onClick={onPick} aria-label={`Colour ${color}`} aria-pressed={active}><span aria-hidden='true' /></button>
}

function FashionChoice({ style, active, onPick }: { style: FashionStyle, active: boolean, onPick: () => void }) {
  return <StyleChoice label={style.label} glyph={style.glyph} atelier={style.tier === 'atelier'} active={active} onPick={onPick} />
}

function StyleChoice({ label, glyph, atelier = false, active, onPick }: { label: string, glyph?: string, atelier?: boolean, active: boolean, onPick: () => void }) {
  const accessibleLabel = atelier ? `${label}, Poplur Atelier` : label
  return <button type='button' className={active ? styles.layerChoiceActive : styles.layerChoice} data-fashion-tier={atelier ? 'atelier' : 'classic'} onClick={onPick} aria-label={accessibleLabel} aria-pressed={active}><span className={styles.choiceGlyph} aria-hidden='true'>{glyph ?? label.slice(0, 1)}</span><span className={styles.choiceLabel}><small>{label}</small>{atelier && <em>Atelier</em>}</span></button>
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
    const next = Math.round(ratio * (steps.length - 1))
    if (next !== active) onChange(steps[next])
  }
  const updateFromKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? steps.length - 1 : Math.max(0, Math.min(steps.length - 1, active + delta))
    onChange(steps[next])
  }
  const labelId = `character-${label.toLowerCase()}-label`
  return <div className={vertical ? styles.scaleControlVertical : styles.scaleControl} role='group' aria-labelledby={labelId}>
    <span id={labelId} className={styles.scaleLabel}>{label}</span>
    <div className={styles.scaleRail} role='slider' tabIndex={0} aria-labelledby={labelId} aria-valuemin={0} aria-valuemax={3} aria-valuenow={active} aria-valuetext={SCALE_LABELS[active]} style={{ '--scale-progress': `${active / (steps.length - 1) * 100}%`, '--scale-position': `${active / (steps.length - 1) * 100}%` } as React.CSSProperties} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); updateFromPointer(event) }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event) }} onKeyDown={updateFromKey}>
      <span className={styles.scaleThumb} aria-hidden='true'>{SCALE_LABELS[active]}</span>
    </div>
  </div>
}
