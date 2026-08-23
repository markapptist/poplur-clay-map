/**
 * The data-driven wardrobe stage. Scene JSON in, DOM out — there are no
 * wardrobe-specific layout conditions here; every visual decision is read
 * from the scene, the asset registry, or the module registry.
 *
 * Coordinates: the stage letterboxes to the canvas's authored aspect ratio
 * (container-query units, no JS measurement) and every module is placed with
 * percentage offsets, so normalised scene coords survive any container size.
 */
import React, { useEffect, useMemo, useState } from 'react'
import type {
  WardrobeScene,
  WardrobeTransform,
} from './wardrobeTypes'
import { assetSource, getWardrobeAsset } from './wardrobeAssets'
import { anchorOffset, resolveAttachmentPoint } from './wardrobeTransforms'
import { resolveWardrobeTransforms } from './wardrobeCommands'
import { AssetImage, moduleViewFor, type WardrobeModuleViewProps } from './wardrobeModuleRegistry'
import styles from './WardrobeRenderer.module.css'

export interface WardrobeRendererProps {
  scene: WardrobeScene
  mode: 'edit' | 'preview'
  selectedIds?: string[]
  gesturePreview?: Record<string, WardrobeTransform> | null
  snapCandidate?: { parentId: string, pointId: string } | null
  onModulePointerDown?: (id: string, event: React.PointerEvent) => void
}

function transformsEqual(a: WardrobeTransform, b: WardrobeTransform): boolean {
  return a === b || (
    a.x === b.x && a.y === b.y &&
    a.width === b.width && a.height === b.height &&
    a.rotation === b.rotation &&
    (a.scaleX ?? 1) === (b.scaleX ?? 1) &&
    (a.scaleY ?? 1) === (b.scaleY ?? 1)
  )
}

interface ModuleNodeProps extends WardrobeModuleViewProps {
  onModulePointerDown?: (id: string, event: React.PointerEvent) => void
}

const ModuleNode = React.memo(function ModuleNode({
  module, asset, resolved, selected, mode, onModulePointerDown,
}: ModuleNodeProps) {
  const View = moduleViewFor(module.type)
  if (!View) return null
  const off = anchorOffset(asset?.anchor, resolved)
  const sx = resolved.scaleX ?? 1
  const sy = resolved.scaleY ?? 1
  // The scene model scales about the box's top-left and rotates about the
  // EFFECTIVE (scaled) box's center — see wardrobeTransforms. The scaled
  // chain reproduces exactly that so snap dots and hit maths line up:
  // translate(c) rotate translate(-c) scale, with c at the effective center.
  const scaled = sx !== 1 || sy !== 1
  let transform: string | undefined
  if (scaled) {
    transform =
      `translate(${sx * 50}%, ${sy * 50}%) rotate(${resolved.rotation}deg) ` +
      `translate(${sx * -50}%, ${sy * -50}%) scale(${sx}, ${sy})`
  } else if (resolved.rotation) {
    transform = `rotate(${resolved.rotation}deg)`
  }
  return (
    <div
      className={selected ? `${styles.module} ${styles.selected}` : styles.module}
      style={{
        left: `${(resolved.x - off.x) * 100}%`,
        top: `${(resolved.y - off.y) * 100}%`,
        width: `${resolved.width * 100}%`,
        height: `${resolved.height * 100}%`,
        transform,
        transformOrigin: scaled ? '0 0' : '50% 50%',
        opacity: module.opacity,
      }}
      onPointerDown={mode === 'edit' && onModulePointerDown
        ? event => onModulePointerDown(module.id, event)
        : undefined}
    >
      <View module={module} asset={asset} resolved={resolved} selected={selected} mode={mode} />
    </div>
  )
}, (prev, next) =>
  prev.module === next.module &&
  prev.asset === next.asset &&
  prev.selected === next.selected &&
  prev.mode === next.mode &&
  prev.onModulePointerDown === next.onModulePointerDown &&
  transformsEqual(prev.resolved, next.resolved))

export default function WardrobeRenderer({
  scene, mode, selectedIds, gesturePreview, snapCandidate, onModulePointerDown,
}: WardrobeRendererProps) {
  // Single visibilitychange listener for the whole stage: the data attribute
  // it stamps is what pauses every CSS animation below (light pulses, snap
  // dot) while the document is hidden.
  const [docHidden, setDocHidden] = useState(() => typeof document !== 'undefined' && document.hidden)
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisibility = () => setDocHidden(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const resolved = useMemo(
    () => resolveWardrobeTransforms(scene, gesturePreview ?? null),
    [scene, gesturePreview],
  )

  const ordered = useMemo(() =>
    scene.modules
      .map((module, index) => ({ module, index }))
      .sort((a, b) => (a.module.layer - b.module.layer) || (a.index - b.index))
      .map(entry => entry.module),
  [scene.modules])

  const selectedSet = useMemo(() => new Set(selectedIds ?? []), [selectedIds])

  const snapPoint = useMemo(() => {
    if (!snapCandidate || mode !== 'edit') return null
    const parent = scene.modules.find(m => m.id === snapCandidate.parentId)
    if (!parent) return null
    const parentAsset = getWardrobeAsset(parent.assetId)
    const point = parentAsset?.attachmentPoints?.find(p => p.id === snapCandidate.pointId)
    if (!point) return null
    return resolveAttachmentPoint(resolved[parent.id] ?? parent.transform, point, parentAsset?.anchor)
  }, [snapCandidate, mode, scene.modules, resolved])

  const backgroundAsset = scene.canvas.backgroundAssetId
    ? getWardrobeAsset(scene.canvas.backgroundAssetId)
    : undefined
  const ratio = scene.canvas.height > 0 ? scene.canvas.width / scene.canvas.height : 1

  const stageStyle = {
    '--stage-ratio': String(ratio),
    '--wardrobe-primary': scene.theme.primaryColor,
    '--wardrobe-secondary': scene.theme.secondaryColor,
    '--wardrobe-accent': scene.theme.accentColor ?? scene.theme.primaryColor,
  } as React.CSSProperties
  if (scene.canvas.backgroundColor) stageStyle.background = scene.canvas.backgroundColor

  return (
    <div className={styles.frame}>
      <div
        className={mode === 'preview' ? `${styles.stage} ${styles.preview}` : styles.stage}
        style={stageStyle}
        data-wardrobe-stage='true'
        data-doc-hidden={docHidden ? 'true' : undefined}
      >
        {backgroundAsset && (
          <AssetImage
            assetId={backgroundAsset.assetId}
            src={assetSource(backgroundAsset)}
            className={styles.backgroundImage}
          />
        )}
        {ordered.map(module => module.visible === false ? null : (
          <ModuleNode
            key={module.id}
            module={module}
            asset={getWardrobeAsset(module.assetId)}
            resolved={resolved[module.id] ?? module.transform}
            selected={mode === 'edit' && selectedSet.has(module.id)}
            mode={mode}
            onModulePointerDown={mode === 'edit' ? onModulePointerDown : undefined}
          />
        ))}
        {snapPoint && (
          <div
            className={styles.snapDot}
            style={{ left: `${snapPoint.x * 100}%`, top: `${snapPoint.y * 100}%` }}
          />
        )}
      </div>
    </div>
  )
}
