import { lazy, Suspense } from 'react'
import styles from './VFXStudio.module.css'

const CustomVFXModel = lazy(() => import('./CustomVFXModel'))
export const BAKED_VFX_OBJECTS: Record<string, string> = {
  globe: 'vfx-sprites/globe.png', camera: 'vfx-sprites/camera.png',
  tv: 'vfx-sprites/tv.png', mic: 'vfx-sprites/mic.png',
  plane: 'vfx-sprites/plane.png', pin: 'vfx-sprites/pin.png',
}

/** Stock overlays have a fixed camera; placement, size, rotation and cue timing
 * belong to the editor around this image. Only a new custom model needs 3D. */
export default function VFXObjectPreview({ id, src, name, active, fallbackSrc }: {
  id: string; src: string; name: string; active: boolean; fallbackSrc: string
}) {
  const baked = BAKED_VFX_OBJECTS[id]
  const image = <img className={styles.activeModelFallback}
    src={baked ? `${import.meta.env.BASE_URL}${baked}` : fallbackSrc}
    alt={`${name} overlay`} draggable={false} />
  if (baked || !active || id !== 'meshy') return image
  return <Suspense fallback={image}><CustomVFXModel src={src} name={name} active fallbackSrc={fallbackSrc} /></Suspense>
}
