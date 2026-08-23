import React, { useEffect, useRef, useState } from 'react'
import type {
  WardrobeAssetDefinition,
  WardrobeCharacterAppearance,
  WardrobeModule,
  WardrobeModuleType,
  WardrobeTransform,
} from './wardrobeTypes'
import {
  assetSource,
  hasWardrobeAssetArt,
  wardrobeFallbackGlyph,
  wardrobeFallbackTone,
} from './wardrobeAssets'
import { poplurFromAppearance } from './wardrobeCharacter'
import ClayCharacter from '../ClayCharacter'
import styles from './WardrobeRenderer.module.css'

/** Contract between WardrobeRenderer and every module view. The renderer owns
    position/size/rotation/opacity on the wrapper; views only fill the box. */
export interface WardrobeModuleViewProps {
  module: WardrobeModule
  asset: WardrobeAssetDefinition | undefined
  resolved: WardrobeTransform
  selected: boolean
  mode: 'edit' | 'preview'
}

// One warning per asset/type for the whole session — a 250-module scene must
// not spam the console once per instance per render.
const warnedAssetIds = new Set<string>()
const warnedTypes = new Set<string>()

function warnAssetOnce(assetId: string, detail: string): void {
  if (warnedAssetIds.has(assetId)) return
  warnedAssetIds.add(assetId)
  console.warn(`[wardrobe] ${detail}: ${assetId}`)
}

/** Missing optional PNGs must not turn a scene into empty selection boxes.
    This deliberately small CSS visual is stable offline and is also used by
    the library thumbnail, while the asset id remains ready for future art. */
function AssetFallback({ module, asset }: Pick<WardrobeModuleViewProps, 'module' | 'asset'>) {
  const tone = module.tint || wardrobeFallbackTone(module.assetId, module.type)
  const visualStyle = typeof module.properties?.visualStyle === 'string'
    ? module.properties.visualStyle
    : undefined
  const side = module.properties?.side === 'left' || module.properties?.side === 'right'
    ? module.properties.side
    : undefined
  return (
    <div
      className={styles.assetFallback}
      data-module-type={module.type}
      data-visual-style={visualStyle}
      data-side={side}
      title={asset?.name ?? module.assetId}
      aria-hidden='true'
      style={{ '--fallback-tone': tone } as React.CSSProperties}
    >
      <span className={styles.assetFallbackGlyph}>{wardrobeFallbackGlyph(module.type)}</span>
    </div>
  )
}

/** Shared by module views and the renderer's scene background. Vite answers a
    missing public/ file with 200 text/html, so onError on the <img> is the
    ONLY reliable missing-asset detector — never a fetch status check. */
export function AssetImage({ assetId, src, className }: {
  assetId: string
  src: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return null
  return (
    <img
      src={src}
      alt=''
      draggable={false}
      className={className}
      onError={() => {
        warnAssetOnce(assetId, 'asset image failed to load')
        setFailed(true)
      }}
    />
  )
}

/** The one view most module types share: the asset's art, contained in the
    module box. Tint is a masked multiply overlay built only when a tint is
    actually set (and the asset is tintable) so the common path stays a bare
    <img>. */
function ImageModule({ module, asset }: WardrobeModuleViewProps) {
  const [failed, setFailed] = useState(false)
  // Group containers are structure-only and intentionally have no art.
  if (module.properties?.isGroup === true) return null
  if (!asset) {
    warnAssetOnce(module.assetId, 'no asset definition registered')
    return <AssetFallback module={module} asset={asset} />
  }
  if (!hasWardrobeAssetArt(asset)) return <AssetFallback module={module} asset={asset} />
  if (failed) return <AssetFallback module={module} asset={asset} />
  const src = assetSource(asset)
  const tint = asset.tintable ? module.tint : undefined
  const img = (
    <img
      src={src}
      alt=''
      draggable={false}
      className={styles.assetImage}
      onError={() => {
        warnAssetOnce(asset.assetId, 'asset image failed to load')
        // State (not display:none) so the tint overlay disappears too — a
        // failed mask-image url would otherwise paint the whole box pink.
        setFailed(true)
      }}
    />
  )
  if (!tint) return img
  return (
    <div className={styles.imageBox}>
      {img}
      <div
        className={styles.tintOverlay}
        style={{
          backgroundColor: tint,
          WebkitMaskImage: `url("${src}")`,
          maskImage: `url("${src}")`,
        }}
      />
    </div>
  )
}

/** A rail remains one removable module; its decorative hangers are derived
    from scene data and carry no selection/attachment identity of their own. */
function RailModule(props: WardrobeModuleViewProps) {
  const { module, asset } = props
  if (asset && hasWardrobeAssetArt(asset)) return <ImageModule {...props} />
  const requested = module.properties?.hangerCount
  const hangerCount = typeof requested === 'number' && Number.isFinite(requested)
    ? Math.max(0, Math.min(12, Math.round(requested)))
    : 0
  return (
    <div className={styles.railAssembly}>
      <AssetFallback module={module} asset={asset} />
      {hangerCount > 0 && (
        <div className={styles.railHangers} aria-hidden='true'>
          {Array.from({ length: hangerCount }, (_, index) => (
            <span
              key={index}
              className={styles.railHanger}
              style={{ left: `${((index + 1) / (hangerCount + 1)) * 100}%` }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Radial glow. The pulse only runs in preview or when the module opts in via
    animation.autoplay, and pauses whenever the renderer stamps
    data-doc-hidden (see WardrobeRenderer.module.css) — no JS timers. */
function LightModule({ module, mode }: WardrobeModuleViewProps) {
  const color = module.tint || 'var(--wardrobe-primary, #ff2d9a)'
  const rawIntensity = module.properties?.intensity
  const intensity = typeof rawIntensity === 'number' ? rawIntensity : 0.85
  const shape = typeof module.properties?.shape === 'string'
    ? module.properties.shape
    : 'spot'
  const animate = mode === 'preview' || module.animation?.autoplay === true
  const speed = module.animation?.speed
  return (
    <div
      className={animate ? `${styles.light} ${styles.lightPulse}` : styles.light}
      data-light-shape={shape}
      style={{
        '--light-color': color,
        opacity: intensity,
        animationDuration: animate && speed ? `${2.4 / speed}s` : undefined,
      } as React.CSSProperties}
    />
  )
}

/** ClayCharacter draws at a fixed pixel height, but the module box is sized
    in fractions of the stage — a ResizeObserver (event-driven, no loops)
    supplies the pixel height. Nothing renders until the first measurement so
    the character never flashes at a wrong size. */
function CharacterModule({ module }: WardrobeModuleViewProps) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [boxHeight, setBoxHeight] = useState(0)
  useEffect(() => {
    const el = boxRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      const next = Math.round(entries[entries.length - 1].contentRect.height)
      setBoxHeight(prev => (prev === next ? prev : next))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const raw = module.properties?.appearance
  const character = raw && typeof raw === 'object'
    ? poplurFromAppearance(raw as WardrobeCharacterAppearance)
    : null
  return (
    <div ref={boxRef} className={styles.characterBox}>
      {boxHeight > 0 && <ClayCharacter character={character} height={boxHeight} />}
    </div>
  )
}

let particleWarned = false

function ParticleEffectModule() {
  if (import.meta.env.DEV && !particleWarned) {
    particleWarned = true
    console.warn('particles not yet supported')
  }
  return null
}

export const wardrobeModuleRegistry: Record<WardrobeModuleType, React.ComponentType<WardrobeModuleViewProps>> = {
  wardrobeFrame: ImageModule,
  wardrobeDoor: ImageModule,
  divider: ImageModule,
  shelf: ImageModule,
  drawer: ImageModule,
  cabinet: ImageModule,
  rail: RailModule,
  hook: ImageModule,
  shoeRack: ImageModule,
  storageBox: ImageModule,
  mirror: ImageModule,
  rug: ImageModule,
  hangingClothing: ImageModule,
  foldedClothing: ImageModule,
  shoe: ImageModule,
  hat: ImageModule,
  handbag: ImageModule,
  jewelry: ImageModule,
  perfume: ImageModule,
  cosmetic: ImageModule,
  plant: ImageModule,
  decoration: ImageModule,
  trophy: ImageModule,
  light: LightModule,
  particleEffect: ParticleEffectModule,
  character: CharacterModule,
  background: ImageModule,
  floor: ImageModule,
}

/** A scene document can carry a type this build has never heard of (newer
    client wrote it) — warn once per unknown type and render nothing rather
    than crash the whole closet. */
export function moduleViewFor(type: string): React.ComponentType<WardrobeModuleViewProps> | null {
  const view = wardrobeModuleRegistry[type as WardrobeModuleType]
  if (view) return view
  if (!warnedTypes.has(type)) {
    warnedTypes.add(type)
    console.warn(`[wardrobe] no module view registered for type: ${type}`)
  }
  return null
}
