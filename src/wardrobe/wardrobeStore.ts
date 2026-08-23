import { useSyncExternalStore } from 'react'
import type {
  WardrobeAttachment,
  WardrobeCommand,
  WardrobeEditorApi,
  WardrobeEditorState,
  WardrobeModule,
  WardrobePrefab,
  WardrobeScene,
  WardrobeTheme,
  WardrobeTransform,
} from './wardrobeTypes'
import { CURRENT_SCENE_VERSION, wardrobeId } from './wardrobeTypes'
import { resolveAttachmentPoint, wouldCreateCycle } from './wardrobeTransforms'
import { canAttach, validateEditableModules } from './wardrobeValidation'
import { getWardrobeAsset } from './wardrobeAssets'
import {
  addModuleCommand,
  applyPrefabCommand,
  applyThemeCommand,
  attachModuleCommand,
  detachModuleCommand,
  duplicateModulesCommand,
  groupModulesCommand,
  removeModulesCommand,
  setLayerCommand,
  setModulePropsCommand,
  setParentCommand,
  ungroupModulesCommand,
  updateTransformsCommand,
} from './wardrobeCommands'

// Module-singleton editor store, subscribed from React via
// useSyncExternalStore (the project convention — see controlPlacement.ts).
// Persistence is explicit: only saveWardrobe() writes to Firestore, and the
// repository/migrations modules load via dynamic import so pure-logic tests
// never pull in firebase.

function emptyScene(name: string): WardrobeScene {
  return {
    id: wardrobeId('wardrobe'),
    name,
    version: CURRENT_SCENE_VERSION,
    canvas: { width: 1080, height: 1350 },
    theme: { primaryColor: '#FF2D9A', secondaryColor: '#111111' },
    modules: [],
  }
}

function freshState(scene: WardrobeScene): WardrobeEditorState {
  return {
    scene,
    selectedIds: [],
    gesturePreview: null,
    snapCandidate: null,
    canUndo: false,
    canRedo: false,
    mode: 'edit',
    dirty: false,
    saving: false,
    loadError: null,
  }
}

let state: WardrobeEditorState = freshState(emptyScene('My Wardrobe'))
let undoStack: WardrobeCommand[] = []
let redoStack: WardrobeCommand[] = []
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

function setState(patch: Partial<WardrobeEditorState>): void {
  state = { ...state, ...patch }
  emit()
}

function pruneSelection(scene: WardrobeScene, selectedIds: string[]): string[] {
  const alive = new Set(scene.modules.map(m => m.id))
  const kept = selectedIds.filter(id => alive.has(id))
  return kept.length === selectedIds.length ? selectedIds : kept
}

function runCommand(command: WardrobeCommand | null, extra?: Partial<WardrobeEditorState>): void {
  if (!command) return
  undoStack.push(command)
  redoStack = []
  const scene = command.apply(state.scene)
  const selectedIds = pruneSelection(scene, extra?.selectedIds ?? state.selectedIds)
  setState({ ...extra, scene, selectedIds, dirty: true, canUndo: true, canRedo: false })
}

/** Store-level lock enforcement. UI controls are convenience, not a security
    boundary: every mutation path must reject the whole command atomically if
    it would alter a locked target (or a locked descendant moved/detached as a
    side effect). */
function editableOrWarn(
  ids: Iterable<string>,
  action: string,
  includeDescendants = false,
): boolean {
  const result = validateEditableModules(state.scene, ids, { action, includeDescendants })
  if (result.ok) return true
  console.warn(`[wardrobe] ${action} rejected`, result.issues)
  return false
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function getState(): WardrobeEditorState {
  return state
}

export const wardrobeEditor: WardrobeEditorApi = {
  getState,
  subscribe,

  loadScene(scene: WardrobeScene): void {
    undoStack = []
    redoStack = []
    state = freshState(scene)
    emit()
  },

  newScene(name: string): void {
    wardrobeEditor.loadScene(emptyScene(name))
  },

  addModule(module: Omit<WardrobeModule, 'id'>): string {
    const id = wardrobeId(module.type)
    runCommand(addModuleCommand(state.scene, { ...module, id }), { selectedIds: [id] })
    return id
  },

  removeModules(ids: string[]): void {
    if (!editableOrWarn(ids, 'delete', true)) return
    runCommand(removeModulesCommand(state.scene, ids))
  },

  duplicateModules(ids: string[]): string[] {
    const built = duplicateModulesCommand(state.scene, ids)
    if (!built) return []
    runCommand(built.command, { selectedIds: built.newIds })
    return built.newIds
  },

  updateTransforms(patch: Record<string, WardrobeTransform>, label?: string): void {
    if (!editableOrWarn(Object.keys(patch), (label ?? 'transform').toLowerCase(), true)) return
    runCommand(updateTransformsCommand(state.scene, patch, label))
  },

  previewTransforms(patch: Record<string, WardrobeTransform> | null): void {
    setState({ gesturePreview: patch })
  },

  setSnapCandidate(candidate: { parentId: string, pointId: string } | null): void {
    setState({ snapCandidate: candidate })
  },

  attachModule(id: string, attachment: WardrobeAttachment): void {
    const scene = state.scene
    const child = scene.modules.find(m => m.id === id)
    const parent = scene.modules.find(m => m.id === attachment.parentId)
    const parentAsset = parent ? getWardrobeAsset(parent.assetId) : undefined
    if (!child || !parent || !parentAsset) {
      console.warn('[wardrobe] attach rejected: unknown module or parent asset', id, attachment)
      return
    }
    if (!editableOrWarn([id], 'attach')) return
    if (!canAttach(child.type, parentAsset, attachment.pointId)) {
      console.warn('[wardrobe] attach rejected by canAttach', child.type, attachment)
      return
    }
    if (wouldCreateCycle(scene, id, attachment.parentId)) {
      console.warn('[wardrobe] attach rejected: would create a cycle', id, attachment)
      return
    }
    const point = parentAsset.attachmentPoints?.find(p => p.id === attachment.pointId)
    const snapped = point ? resolveAttachmentPoint(parent.transform, point) : null
    const transform = snapped ? { ...child.transform, x: snapped.x, y: snapped.y } : undefined
    runCommand(attachModuleCommand(scene, id, attachment, transform))
  },

  detachModule(id: string): void {
    if (!editableOrWarn([id], 'detach')) return
    runCommand(detachModuleCommand(state.scene, id))
  },

  setParent(id: string, parentId: string | undefined): void {
    const scene = state.scene
    if (!editableOrWarn([id], 'reparent')) return
    if (parentId !== undefined) {
      if (!scene.modules.some(m => m.id === parentId)) {
        console.warn('[wardrobe] setParent rejected: unknown parent', id, parentId)
        return
      }
      if (wouldCreateCycle(scene, id, parentId)) {
        console.warn('[wardrobe] setParent rejected: would create a cycle', id, parentId)
        return
      }
    }
    runCommand(setParentCommand(scene, id, parentId))
  },

  setLayer(ids: string[], delta: number): void {
    if (!editableOrWarn(ids, 'reorder')) return
    runCommand(setLayerCommand(state.scene, ids, delta))
  },

  setModuleProps(id, patch): void {
    const module = state.scene.modules.find(candidate => candidate.id === id)
    const unlockOnly = module?.locked === true
      && patch.locked === false
      && Object.keys(patch).every(key => key === 'locked')
    if (!unlockOnly && !editableOrWarn([id], 'edit')) return
    runCommand(setModulePropsCommand(state.scene, id, patch))
  },

  groupModules(ids: string[]): void {
    if (!editableOrWarn(ids, 'group')) return
    const built = groupModulesCommand(state.scene, ids)
    if (!built) return
    runCommand(built.command, { selectedIds: [built.groupId] })
  },

  ungroupModules(ids: string[]): void {
    if (!editableOrWarn(ids, 'ungroup', true)) return
    runCommand(ungroupModulesCommand(state.scene, ids))
  },

  applyPrefab(prefab: WardrobePrefab, at: { x: number, y: number }): string[] {
    const built = applyPrefabCommand(state.scene, prefab, at)
    if (!built) return []
    runCommand(built.command, { selectedIds: built.newIds })
    return built.newIds
  },

  applyTheme(theme: WardrobeTheme): void {
    runCommand(applyThemeCommand(state.scene, theme))
  },

  select(ids: string[]): void {
    setState({ selectedIds: pruneSelection(state.scene, [...ids]) })
  },

  setMode(mode: 'edit' | 'preview'): void {
    setState({ mode })
  },

  undo(): void {
    const command = undoStack.pop()
    if (!command) return
    redoStack.push(command)
    const scene = command.revert(state.scene)
    setState({
      scene,
      selectedIds: pruneSelection(scene, state.selectedIds),
      dirty: true,
      canUndo: undoStack.length > 0,
      canRedo: true,
    })
  },

  redo(): void {
    const command = redoStack.pop()
    if (!command) return
    undoStack.push(command)
    const scene = command.apply(state.scene)
    setState({
      scene,
      selectedIds: pruneSelection(scene, state.selectedIds),
      dirty: true,
      canUndo: true,
      canRedo: redoStack.length > 0,
    })
  },

  async saveWardrobe(): Promise<void> {
    if (state.saving) return
    const sceneAtSave = state.scene
    setState({ saving: true, loadError: null })
    try {
      const repository = await import('./wardrobeRepository')
      const savedId = await repository.saveWardrobeScene(sceneAtSave)
      // Commands may have landed during the await: only clear dirty when the
      // scene we saved is still the current one, and adopt a repository-
      // assigned id without touching history (id changes are not undoable).
      const current = state.scene
      const scene = savedId && savedId !== current.id ? { ...current, id: savedId } : current
      setState({ scene, saving: false, dirty: current !== sceneAtSave })
    } catch (error) {
      // Dirty stays true so Save remains available, but surface the failure in
      // editor state and reject so callers can report/telemetry it too.
      const message = error instanceof Error ? error.message : String(error)
      console.warn('[wardrobe] save failed', error)
      setState({ saving: false, loadError: message })
      throw error
    }
  },

  async loadWardrobe(id: string): Promise<void> {
    setState({ loadError: null })
    try {
      const repository = await import('./wardrobeRepository')
      const raw = await repository.loadWardrobeScene(id)
      const migrations = await import('./wardrobeMigrations')
      wardrobeEditor.loadScene(migrations.migrateWardrobeScene(raw))
    } catch (error) {
      setState({ loadError: error instanceof Error ? error.message : String(error) })
    }
  },
}

export function useWardrobeEditor(): WardrobeEditorState {
  return useSyncExternalStore(subscribe, getState, getState)
}

export function useWardrobeEditorApi(): WardrobeEditorApi {
  return wardrobeEditor
}
