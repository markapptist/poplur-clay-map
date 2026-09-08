import React, { useEffect, useRef, useState } from 'react'
import { ModelViewerElement } from '@google/model-viewer'
import { PoplurPerformanceManager } from './poplurPerformanceManager'
import styles from './VFXStudio.module.css'

ModelViewerElement.meshoptDecoderLocation = `${import.meta.env.BASE_URL}meshopt_decoder.js`
ModelViewerElement.minimumRenderScale = 1
let vfxModelSequence = 0

export default function CustomVFXModel({
  src,
  name,
  active,
  fallbackSrc,
}: {
  src: string
  name: string
  active: boolean
  fallbackSrc: string
}) {
  const [rendererID] = useState(() => `vfx-model-${++vfxModelSequence}`)
  const rendererHandle = useRef<ReturnType<typeof PoplurPerformanceManager.registerRenderer> | null>(null)
  const [rendererState, setRendererState] = useState({ active: false, shadows: false })

  useEffect(() => {
    let alive = true
    const handle = PoplurPerformanceManager.registerRenderer({
      id: rendererID,
      heavy: true,
      priority: 96,
      visible: true,
      demanded: active,
      onActiveChange: (granted, policy) => {
        if (!alive) return
        setRendererState({
          active: granted && policy.decorativeRenderingAllowed,
          shadows: policy.dynamicShadowsAllowed,
        })
      },
    })
    rendererHandle.current = handle
    return () => {
      alive = false
      rendererHandle.current = null
      handle.dispose()
    }
  }, [rendererID])

  useEffect(() => rendererHandle.current?.setDemand(active), [active])

  if (!active || !rendererState.active) {
    return <img className={styles.activeModelFallback} src={fallbackSrc} alt={`${name} overlay`} />
  }

  return React.createElement('model-viewer', {
    class: styles.activeModel,
    src,
    alt: `${name} 3D overlay`,
    'camera-orbit': '20deg 72deg 2.8m',
    'field-of-view': '28deg',
    exposure: '1.2',
    shadowIntensity: rendererState.shadows ? '1.1' : '0',
    shadowSoftness: '.8',
    interactionPrompt: 'none',
    disableZoom: true,
    loading: active ? 'eager' : 'lazy',
  })
}
