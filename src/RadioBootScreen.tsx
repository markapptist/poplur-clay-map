import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import styles from './RadioScreen.module.css'
import { releaseWebGL } from './threeCleanup'
import { playRadioPowerOn } from './radioPowerSound'

// POWER ON — the deck warming up.
//
// The TV is the real 3D model, rendered live: real geometry, real lights, a
// real turn on its own axis. Nothing is baked to an image.
//
// clay_tv.glb is the pink clay TV the user supplied, Draco + WebP compressed
// from 30.4 MB to 137 KB — a 2.3 second boot cannot wait on a 30 MB download.
const MODELS = ['clay_tv.glb']

export default function RadioBootScreen({ onDone }: { onDone: () => void }) {
  const holderRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    playRadioPowerOn()
    const t = window.setTimeout(onDone, 2350)
    return () => window.clearTimeout(t)
  }, [onDone])

  useEffect(() => {
    const holder = holderRef.current
    if (!holder) return

    let renderer: THREE.WebGLRenderer | null = null
    let frame = 0
    let alive = true

    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    } catch {
      return // no GL: the wordmark and the status line still boot the deck
    }
    const size = 190
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    renderer.setSize(size, size)
    renderer.setClearColor(0x000000, 0)
    renderer.domElement.className = styles.bootCanvas
    holder.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100)

    // Lit for the panel it sits on: a warm key so the clay reads as clay, and
    // a green rim borrowed from the backlight so the model belongs to the
    // screen it is turning on.
    scene.add(new THREE.AmbientLight(0xbfe8b0, 1.5))
    const key = new THREE.DirectionalLight(0xfff2e2, 2.4)
    key.position.set(-2, 3, 4)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0x7eff6a, 1.8)
    rim.position.set(3, -1, -3)
    scene.add(rim)

    const pivot = new THREE.Group()
    scene.add(pivot)

    const loader = new GLTFLoader()
    const draco = new DRACOLoader()
    draco.setDecoderPath('draco/')
    loader.setDRACOLoader(draco)

    // Take the first model that actually loads, in preference order.
    const loadFirst = async () => {
      for (const url of MODELS) {
        try { return await loader.loadAsync(url) } catch { /* try the next */ }
      }
      return null
    }

    void loadFirst().then(gltf => {
      if (!alive || !gltf || !renderer) return
      const model = gltf.scene

      // Centre it, then frame the camera off its own bounding sphere — so a
      // model dropped in later is composed the same way without new numbers.
      const box = new THREE.Box3().setFromObject(model)
      model.position.sub(box.getCenter(new THREE.Vector3()))
      const radius = Math.max(0.001, box.getBoundingSphere(new THREE.Sphere()).radius)
      pivot.add(model)
      camera.position.set(0, radius * 0.16, radius * 2.35)
      camera.lookAt(0, 0, 0)

      let last = performance.now()
      const tick = (now: number) => {
        if (!alive || !renderer) return
        const dt = Math.min(0.05, (now - last) / 1000)
        last = now
        pivot.rotation.y += dt * 1.75                            // turning, nonstop
        pivot.position.y = Math.sin(now / 620) * radius * 0.045   // and breathing
        renderer.render(scene, camera)
        frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
    })

    // The boot is short and mounts every time the deck opens: everything it
    // allocated goes back, or the GL context leaks one per visit.
    return () => {
      alive = false
      cancelAnimationFrame(frame)
      draco.dispose()
      scene.traverse(obj => {
        const mesh = obj as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.geometry?.dispose()
        const mat = mesh.material
        if (Array.isArray(mat)) mat.forEach(m => m.dispose())
        else mat?.dispose()
      })
      // Detach FIRST, then release: releaseWebGL only forces context loss on a
      // canvas that is off the DOM, which is what tells it the element will not
      // be reused. dispose() alone left this context alive until GC happened to
      // collect the canvas — one stranded context per radio boot, and WKWebView
      // accumulates them rather than evicting (see threeCleanup).
      renderer?.domElement.remove()
      releaseWebGL(renderer)
      renderer = null
    }
  }, [])

  return (
    <div className={styles.boot} role="status" aria-label="Poplur Radio starting up">
      <span className={styles.bootGrid} aria-hidden="true" />
      <span className={styles.bootGlass} aria-hidden="true" />
      <div className={styles.bootInner}>
        <div className={styles.bootWord}>POPLUR RADIO</div>
        <div className={styles.bootStage} aria-hidden="true">
          <div ref={holderRef} className={styles.bootModel} />
          <span className={styles.bootShadow} />
        </div>
        <div className={styles.bootStatus}>
          <span>WARMING UP</span>
          <span className={styles.bootDots}><i /><i /><i /></span>
        </div>
      </div>
    </div>
  )
}
