import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type {
  WardrobeAssetDefinition,
  WardrobePrefab,
  WardrobePrefabModule,
  WardrobeScene,
  WardrobeTransform,
} from './wardrobeTypes'
import type { PoplurCharacter } from '../characterStore'
import { wardrobeId } from './wardrobeTypes'
import { wardrobeEditor, useWardrobeEditor } from './wardrobeStore'
import { clampTransform, collectDescendants, findSnapCandidate, moveModules } from './wardrobeTransforms'
import { getWardrobeAsset } from './wardrobeAssets'
import { pinkStarterCloset } from './samples/pinkStarterCloset'
import { sceneWithPoplurCharacter } from './wardrobeCharacter'
import { newestWardrobeId } from './wardrobeSavedScenes'
import WardrobeRenderer from './WardrobeRenderer'
import WardrobePreview from './WardrobePreview'
import ModuleLibrary from './panels/ModuleLibrary'
import LayersPanel from './panels/LayersPanel'
import PropertiesPanel from './panels/PropertiesPanel'
import { playPop } from '../pop'
import styles from './WardrobeBuilder.module.css'

const LONG_PRESS_MS = 350
const DRAG_SLOP_PX = 6
const CUSTOM_PREFABS_KEY = 'poplur.wardrobe.customPrefabs'

type SnapHit = { parentId: string, pointId: string, x: number, y: number }

type Gesture = {
  kind: 'drag' | 'pinch'
  pointerId: number
  primaryId: string
  moveIds: string[]
  pointers: Map<number, { x: number, y: number }>
  start: { x: number, y: number }
  box: { width: number, height: number }
  moved: boolean
  longPressTimer: number | null
  lastPatch: Record<string, WardrobeTransform> | null
  snap: SnapHit | null
  pinch: {
    dist: number
    angle: number
    from: WardrobeTransform
    resizable: boolean
    rotatable: boolean
    asset: WardrobeAssetDefinition | undefined
  } | null
}

/** The renderer aspect-fits the authored canvas inside its container, so
    pixel deltas normalise against the fitted box, not the raw layer rect. */
function fittedCanvasBox(rect: { width: number, height: number }, scene: WardrobeScene): { width: number, height: number } {
  const aspect = (scene.canvas.width || 1) / (scene.canvas.height || 1)
  let width = rect.width || 1
  let height = width / aspect
  if (height > (rect.height || 1)) {
    height = rect.height || 1
    width = height * aspect
  }
  return { width: Math.max(width, 1), height: Math.max(height, 1) }
}

/** moveModules moves descendants itself, so a selection containing both a
    parent and its child must only submit the parent; locked modules refuse. */
function movableRoots(scene: WardrobeScene, ids: string[]): string[] {
  const byId = new Map(scene.modules.map(m => [m.id, m]))
  const set = new Set(ids)
  const roots: string[] = []
  for (const id of ids) {
    const module = byId.get(id)
    if (!module || module.locked) continue
    let ancestor = module.parentId ?? module.attachment?.parentId
    let covered = false
    let guard = 0
    while (ancestor && guard++ < 300) {
      if (set.has(ancestor)) { covered = true; break }
      const parent = byId.get(ancestor)
      ancestor = parent ? (parent.parentId ?? parent.attachment?.parentId) : undefined
    }
    if (!covered) roots.push(id)
  }
  return roots
}

function createGestureEngine(getLayer: () => HTMLDivElement | null) {
  let g: Gesture | null = null

  function clearLongPress(gest: Gesture) {
    if (gest.longPressTimer !== null) {
      window.clearTimeout(gest.longPressTimer)
      gest.longPressTimer = null
    }
  }

  function listen() {
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  function unlisten() {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
  }

  function end(commit: (() => void) | null) {
    const gest = g
    if (!gest) return
    clearLongPress(gest)
    g = null
    unlisten()
    if (commit) commit()
    wardrobeEditor.previewTransforms(null)
    wardrobeEditor.setSnapCandidate(null)
  }

  function maybeStartPinch(pointerId: number, x: number, y: number) {
    const gest = g
    if (!gest || gest.kind !== 'drag' || gest.moved || gest.pointers.size !== 1) return
    const scene = wardrobeEditor.getState().scene
    const module = scene.modules.find(m => m.id === gest.primaryId)
    if (!module || module.locked) return
    gest.pointers.set(pointerId, { x, y })
    const pts = [...gest.pointers.values()]
    const dx = pts[1].x - pts[0].x
    const dy = pts[1].y - pts[0].y
    clearLongPress(gest)
    const asset = getWardrobeAsset(module.assetId)
    gest.kind = 'pinch'
    gest.snap = null
    wardrobeEditor.setSnapCandidate(null)
    gest.pinch = {
      dist: Math.max(Math.hypot(dx, dy), 1),
      angle: Math.atan2(dy, dx),
      from: { ...module.transform },
      resizable: asset ? asset.resizable : true,
      rotatable: asset ? asset.rotatable : false,
      asset,
    }
  }

  function pinchMove() {
    const gest = g
    if (!gest || !gest.pinch || gest.pointers.size < 2) return
    const pinch = gest.pinch
    if (!pinch.resizable && !pinch.rotatable) return
    const pts = [...gest.pointers.values()]
    const dx = pts[1].x - pts[0].x
    const dy = pts[1].y - pts[0].y
    const next: WardrobeTransform = { ...pinch.from }
    if (pinch.resizable) {
      const scale = Math.max(Math.hypot(dx, dy), 1) / pinch.dist
      next.width = pinch.from.width * scale
      next.height = pinch.from.height * scale
    }
    if (pinch.rotatable) {
      next.rotation = pinch.from.rotation + ((Math.atan2(dy, dx) - pinch.angle) * 180) / Math.PI
    }
    gest.lastPatch = { [gest.primaryId]: clampTransform(next, pinch.asset) }
    wardrobeEditor.previewTransforms(gest.lastPatch)
  }

  const onMove = (ev: PointerEvent) => {
    const gest = g
    if (!gest || !gest.pointers.has(ev.pointerId)) return
    gest.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
    if (gest.kind === 'pinch') {
      pinchMove()
      return
    }
    if (ev.pointerId !== gest.pointerId) return
    const dxPx = ev.clientX - gest.start.x
    const dyPx = ev.clientY - gest.start.y
    if (!gest.moved) {
      if (Math.hypot(dxPx, dyPx) < DRAG_SLOP_PX) return
      gest.moved = true
      clearLongPress(gest)
    }
    const scene = wardrobeEditor.getState().scene
    const patch = moveModules(scene, gest.moveIds, dxPx / gest.box.width, dyPx / gest.box.height)
    gest.lastPatch = patch
    wardrobeEditor.previewTransforms(patch)
    if (gest.moveIds.length === 1 && gest.moveIds[0] === gest.primaryId) {
      const t = patch[gest.primaryId]
      const hit = t ? findSnapCandidate(scene, gest.primaryId, t) : null
      gest.snap = hit
      wardrobeEditor.setSnapCandidate(hit ? { parentId: hit.parentId, pointId: hit.pointId } : null)
    } else if (gest.snap) {
      gest.snap = null
      wardrobeEditor.setSnapCandidate(null)
    }
  }

  const onUp = (ev: PointerEvent) => {
    const gest = g
    if (!gest || !gest.pointers.has(ev.pointerId)) return
    if (gest.kind === 'pinch') {
      const { primaryId, pinch, lastPatch } = gest
      end(pinch && lastPatch ? () => {
        const t = lastPatch[primaryId]
        if (!t) return
        const rotated = Math.abs(t.rotation - pinch.from.rotation) > 0.5
        const resized = Math.abs(t.width - pinch.from.width) > 0.0005
          || Math.abs(t.height - pinch.from.height) > 0.0005
        if (!rotated && !resized) return
        const label = rotated && resized ? 'Transform' : rotated ? 'Rotate' : 'Resize'
        wardrobeEditor.updateTransforms({ [primaryId]: t }, label)
      } : null)
      return
    }
    if (ev.pointerId !== gest.pointerId) {
      gest.pointers.delete(ev.pointerId)
      return
    }
    const { primaryId, snap, moved, lastPatch } = gest
    end(() => {
      if (!moved) return
      if (snap) {
        wardrobeEditor.attachModule(primaryId, { parentId: snap.parentId, pointId: snap.pointId })
        return
      }
      if (!lastPatch) return
      const scene = wardrobeEditor.getState().scene
      const byId = new Map(scene.modules.map(m => [m.id, m]))
      const clamped: Record<string, WardrobeTransform> = {}
      for (const [id, t] of Object.entries(lastPatch)) {
        const module = byId.get(id)
        clamped[id] = clampTransform(t, module ? getWardrobeAsset(module.assetId) : undefined)
      }
      wardrobeEditor.updateTransforms(clamped, 'Move')
    })
  }

  const onCancel = () => end(null)

  function onModuleDown(id: string, e: ReactPointerEvent) {
    const state = wardrobeEditor.getState()
    if (state.mode !== 'edit') return
    const module = state.scene.modules.find(m => m.id === id)
    if (!module) return
    e.stopPropagation()
    if (module.locked) return
    if (g) {
      maybeStartPinch(e.pointerId, e.clientX, e.clientY)
      return
    }
    e.preventDefault()
    playPop()

    const selected = state.selectedIds
    let nextSelection = selected
    if (e.shiftKey) {
      nextSelection = selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id]
      wardrobeEditor.select(nextSelection)
      if (!nextSelection.includes(id)) return
    } else if (!selected.includes(id)) {
      nextSelection = [id]
      wardrobeEditor.select(nextSelection)
    }

    const layer = getLayer()
    const rect = layer ? layer.getBoundingClientRect() : { width: 1, height: 1 }
    const gest: Gesture = {
      kind: 'drag',
      pointerId: e.pointerId,
      primaryId: id,
      moveIds: movableRoots(state.scene, nextSelection),
      pointers: new Map([[e.pointerId, { x: e.clientX, y: e.clientY }]]),
      start: { x: e.clientX, y: e.clientY },
      box: fittedCanvasBox(rect, state.scene),
      moved: false,
      longPressTimer: null,
      lastPatch: null,
      snap: null,
      pinch: null,
    }
    gest.longPressTimer = window.setTimeout(() => {
      if (g !== gest || gest.moved || gest.kind !== 'drag') return
      gest.longPressTimer = null
      const merged = selected.includes(id) ? selected : [...selected, id]
      wardrobeEditor.select(merged)
      gest.moveIds = movableRoots(wardrobeEditor.getState().scene, merged)
      playPop()
    }, LONG_PRESS_MS)
    g = gest
    listen()
  }

  function onLayerDown(e: ReactPointerEvent) {
    const state = wardrobeEditor.getState()
    if (state.mode !== 'edit') return
    if (g) {
      maybeStartPinch(e.pointerId, e.clientX, e.clientY)
      return
    }
    if (state.selectedIds.length) {
      wardrobeEditor.select([])
      playPop()
    }
  }

  return { onModuleDown, onLayerDown, dispose: () => end(null) }
}

function serializeSelectionPrefab(scene: WardrobeScene, selectedIds: string[]): WardrobePrefab | null {
  if (!selectedIds.length) return null
  const included = new Set<string>(selectedIds)
  for (const id of selectedIds) {
    for (const descendant of collectDescendants(scene, id)) included.add(descendant)
  }
  const byId = new Map(scene.modules.map(m => [m.id, m]))
  const tempIds = new Map<string, string>()
  let counter = 0
  for (const module of scene.modules) {
    if (included.has(module.id)) tempIds.set(module.id, `m${counter++}`)
  }
  if (!tempIds.size) return null
  const modules: WardrobePrefabModule[] = []
  for (const m of scene.modules) {
    const temporaryId = tempIds.get(m.id)
    if (!temporaryId) continue
    const parentTemporaryId = m.parentId ? tempIds.get(m.parentId) : undefined
    const attachmentParent = m.attachment ? tempIds.get(m.attachment.parentId) : undefined
    modules.push({
      temporaryId,
      parentTemporaryId,
      attachment: m.attachment && attachmentParent
        ? { parentTemporaryId: attachmentParent, pointId: m.attachment.pointId }
        : undefined,
      type: m.type,
      assetId: m.assetId,
      transform: { ...m.transform },
      layer: m.layer,
      properties: m.properties ? { ...m.properties } : undefined,
    })
  }
  return {
    id: wardrobeId('prefab'),
    name: `${scene.name} selection`,
    category: 'custom',
    modules,
  }
}

export default function WardrobeBuilder({ initialScene, character, onClose }: {
  initialScene?: WardrobeScene
  character?: PoplurCharacter | null
  onClose?: () => void
}) {
  const state = useWardrobeEditor()
  const [sceneReady, setSceneReady] = useState(false)
  const [openPanel, setOpenPanel] = useState<'library' | 'layers' | 'properties' | null>(null)
  const layerRef = useRef<HTMLDivElement | null>(null)
  const engineRef = useRef<ReturnType<typeof createGestureEngine> | null>(null)
  if (!engineRef.current) engineRef.current = createGestureEngine(() => layerRef.current)
  const engine = engineRef.current

  useEffect(() => {
    let cancelled = false
    const openScene = async () => {
      let scene = initialScene
      if (!scene) {
        const starter = pinkStarterCloset()
        scene = starter
        try {
          // Read-only boot: opening the builder never creates/updates a remote
          // document. Save remains the sole write path and requires a tap.
          const repository = await import('./wardrobeRepository')
          const latestId = newestWardrobeId(await repository.listWardrobes())
          if (latestId) {
            const migrations = await import('./wardrobeMigrations')
            scene = migrations.migrateWardrobeScene(await repository.loadWardrobeScene(latestId))
          }
        } catch {
          // Signed-out/offline users get the local starter without an error
          // banner; no saved remote document was available to them.
          scene = starter
        }
      }
      if (cancelled) return
      wardrobeEditor.loadScene(
        character === undefined ? scene : sceneWithPoplurCharacter(scene, character),
      )
      setSceneReady(true)
    }
    void openScene()
    return () => { cancelled = true }
    // Seeded once per mount — swapping props mid-life means a remount, never
    // a silent reload over a possibly-dirty editing session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => engine.dispose(), [engine])

  const scene = state.scene
  const selectedModules = scene.modules.filter(m => state.selectedIds.includes(m.id))
  const hasSelection = selectedModules.length > 0
  const allLocked = hasSelection && selectedModules.every(m => m.locked)
  const anyVisible = selectedModules.some(m => m.visible !== false)
  const anyAttached = selectedModules.some(m => m.attachment)
  const groupIdsToUngroup = [...new Set(selectedModules.flatMap(module => {
    if (module.properties?.isGroup === true) return [module.id]
    if (!module.parentId) return []
    const parent = scene.modules.find(candidate => candidate.id === module.parentId)
    return parent?.properties?.isGroup === true ? [parent.id] : []
  }))]

  const tap = (action: () => void) => () => {
    playPop()
    action()
  }

  if (!sceneReady) {
    return (
      <div className={styles.root} aria-busy='true'>
        <header className={styles.topBar}>
          <button
            type='button'
            className={styles.barButton}
            aria-label='Close wardrobe builder'
            onClick={tap(() => onClose?.())}
          >
            &#8249;
          </button>
          <h1 className={styles.title}>My Wardrobe</h1>
        </header>
        <div className={styles.loadingScene} role='status'>
          <span className={styles.loadingMark} aria-hidden='true'>P</span>
          <span>Opening your closet…</span>
        </div>
      </div>
    )
  }

  const toggleLock = tap(() => {
    for (const m of selectedModules) wardrobeEditor.setModuleProps(m.id, { locked: !allLocked })
  })

  const toggleVisible = tap(() => {
    for (const m of selectedModules) wardrobeEditor.setModuleProps(m.id, { visible: !anyVisible })
  })

  const detachSelection = tap(() => {
    for (const m of selectedModules) {
      if (m.attachment) wardrobeEditor.detachModule(m.id)
    }
  })

  const savePrefab = tap(() => {
    const prefab = serializeSelectionPrefab(scene, state.selectedIds)
    if (!prefab) return
    console.log('poplur wardrobe prefab', JSON.stringify(prefab))
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(CUSTOM_PREFABS_KEY)
        const list: WardrobePrefab[] = raw ? JSON.parse(raw) : []
        list.push(prefab)
        localStorage.setItem(CUSTOM_PREFABS_KEY, JSON.stringify(list))
      } catch {
        // Quota or a foreign value under the key must not break the editor.
      }
    }
  })

  const onSave = tap(() => {
    wardrobeEditor.saveWardrobe().catch(err => console.warn('wardrobe save failed', err))
  })

  const togglePanel = (panel: 'library' | 'layers' | 'properties') => tap(() => {
    setOpenPanel(current => (current === panel ? null : panel))
  })

  const closeSheet = () => setOpenPanel(null)

  return (
    <div className={styles.root}>
      <header className={styles.topBar}>
        <button
          type='button'
          className={styles.barButton}
          aria-label='Close wardrobe builder'
          onClick={tap(() => onClose?.())}
        >
          &#8249;
        </button>
        <h1 className={styles.title}>{scene.name}</h1>
        <button
          type='button'
          className={styles.barButton}
          aria-label='Undo'
          disabled={!state.canUndo}
          onClick={tap(() => wardrobeEditor.undo())}
        >
          &#8630;
        </button>
        <button
          type='button'
          className={styles.barButton}
          aria-label='Redo'
          disabled={!state.canRedo}
          onClick={tap(() => wardrobeEditor.redo())}
        >
          &#8631;
        </button>
        <button
          type='button'
          className={styles.barButton}
          aria-label='Preview wardrobe'
          onClick={tap(() => wardrobeEditor.setMode('preview'))}
        >
          &#9654;
        </button>
        <button
          type='button'
          className={state.dirty ? `${styles.saveButton} ${styles.saveDirty}` : styles.saveButton}
          disabled={state.saving || !state.dirty}
          onClick={onSave}
        >
          {state.saving ? 'Saving…' : state.dirty ? 'Save' : 'Saved'}
        </button>
      </header>

      {state.loadError && <div className={styles.errorBanner}>{state.loadError}</div>}

      <div className={styles.canvasWrap}>
        <div
          ref={layerRef}
          className={styles.gestureLayer}
          onPointerDown={engine.onLayerDown}
        >
          <WardrobeRenderer
            scene={scene}
            mode='edit'
            selectedIds={state.selectedIds}
            gesturePreview={state.gesturePreview}
            snapCandidate={state.snapCandidate}
            onModulePointerDown={engine.onModuleDown}
          />
        </div>

        {hasSelection && state.mode === 'edit' && (
          <div className={styles.selectionBar}>
            <button
              type='button'
              className={styles.selButton}
              onClick={tap(() => {
                const ids = wardrobeEditor.duplicateModules(state.selectedIds)
                wardrobeEditor.select(ids)
              })}
            >
              Duplicate
            </button>
            <button
              type='button'
              className={styles.selButton}
              onClick={tap(() => wardrobeEditor.removeModules(state.selectedIds))}
            >
              Delete
            </button>
            <button type='button' className={styles.selButton} onClick={toggleLock}>
              {allLocked ? 'Unlock' : 'Lock'}
            </button>
            <button type='button' className={styles.selButton} onClick={toggleVisible}>
              {anyVisible ? 'Hide' : 'Show'}
            </button>
            <button
              type='button'
              className={styles.selButton}
              onClick={tap(() => wardrobeEditor.setLayer(state.selectedIds, 1))}
            >
              Layer up
            </button>
            <button
              type='button'
              className={styles.selButton}
              onClick={tap(() => wardrobeEditor.setLayer(state.selectedIds, -1))}
            >
              Layer down
            </button>
            {selectedModules.length > 1 && (
              <button
                type='button'
                className={styles.selButton}
                onClick={tap(() => wardrobeEditor.groupModules(state.selectedIds))}
              >
                Group
              </button>
            )}
            {groupIdsToUngroup.length > 0 && (
              <button
                type='button'
                className={styles.selButton}
                onClick={tap(() => wardrobeEditor.ungroupModules(groupIdsToUngroup))}
              >
                Ungroup
              </button>
            )}
            {anyAttached && (
              <button type='button' className={styles.selButton} onClick={detachSelection}>
                Detach
              </button>
            )}
            <button type='button' className={styles.selButton} onClick={savePrefab}>
              Save prefab
            </button>
          </div>
        )}
      </div>

      <nav className={styles.tray}>
        <button
          type='button'
          className={openPanel === 'library' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          onClick={togglePanel('library')}
        >
          Library
        </button>
        <button
          type='button'
          className={openPanel === 'layers' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          onClick={togglePanel('layers')}
        >
          Layers
        </button>
        <button
          type='button'
          className={openPanel === 'properties' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          onClick={togglePanel('properties')}
        >
          Properties
        </button>
      </nav>

      {openPanel && (
        <div className={styles.sheetScrim} onPointerDown={() => setOpenPanel(null)}>
          <div className={styles.sheet} onPointerDown={e => e.stopPropagation()}>
            <div className={styles.sheetGrip} aria-hidden='true' />
            <div className={styles.sheetBody}>
              {openPanel === 'library' && <ModuleLibrary onClose={closeSheet} />}
              {openPanel === 'layers' && <LayersPanel onClose={closeSheet} />}
              {openPanel === 'properties' && <PropertiesPanel onClose={closeSheet} />}
            </div>
          </div>
        </div>
      )}

      {state.mode === 'preview' && (
        <WardrobePreview scene={scene} onExit={() => wardrobeEditor.setMode('edit')} />
      )}
    </div>
  )
}
