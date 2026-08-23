import { describe, expect, it, vi } from 'vitest'
import type {
  WardrobeModule,
  WardrobeModuleType,
  WardrobePrefab,
  WardrobeScene,
  WardrobeTransform,
} from '../wardrobeTypes'
import { CURRENT_SCENE_VERSION } from '../wardrobeTypes'
import { wardrobeEditor } from '../wardrobeStore'
import { wardrobeAssetRegistry } from '../wardrobeAssets'
import { canAttach } from '../wardrobeValidation'

const repositoryMocks = vi.hoisted(() => ({
  saveWardrobeScene: vi.fn(),
}))

vi.mock('../wardrobeRepository', () => repositoryMocks)

const editor = wardrobeEditor

function mod(
  id: string,
  type: WardrobeModuleType,
  transform: Partial<WardrobeTransform>,
  rest: Partial<WardrobeModule> = {},
): WardrobeModule {
  return {
    id,
    type,
    assetId: `${type}_asset`,
    transform: { x: 0, y: 0, width: 0.1, height: 0.1, rotation: 0, ...transform },
    layer: 0,
    ...rest,
  }
}

function fixtureScene(modules?: WardrobeModule[]): WardrobeScene {
  return {
    id: 'scene_fixture',
    name: 'Fixture',
    version: CURRENT_SCENE_VERSION,
    canvas: { width: 1080, height: 1350 },
    theme: { primaryColor: '#FF2D9A', secondaryColor: '#111111' },
    modules: modules ?? [
      mod('cabinet_1', 'cabinet', { x: 0.2, y: 0.2, width: 0.3, height: 0.4 }),
      mod('shelf_1', 'shelf', { x: 0.25, y: 0.3, width: 0.2, height: 0.05 }, { parentId: 'cabinet_1' }),
      mod('box_1', 'storageBox', { x: 0.6, y: 0.6 }, { layer: 1 }),
    ],
  }
}

function sceneJson(): string {
  return JSON.stringify(editor.getState().scene)
}

/** A registry combination canAttach itself approves, so the attach tests
    exercise the store path rather than guessing registry content. */
function findAttachable() {
  for (const def of Object.values(wardrobeAssetRegistry)) {
    for (const point of def.attachmentPoints ?? []) {
      for (const childType of point.allowedTypes) {
        if (canAttach(childType, def, point.id)) return { def, point, childType }
      }
    }
  }
  return null
}

describe('wardrobeStore add/remove', () => {
  it('adds a module, marks dirty, and removes it again', () => {
    editor.loadScene(fixtureScene())
    expect(editor.getState().dirty).toBe(false)
    const id = editor.addModule({
      type: 'plant',
      assetId: 'plant_asset',
      transform: { x: 0.8, y: 0.8, width: 0.05, height: 0.08, rotation: 0 },
      layer: 2,
    })
    const afterAdd = editor.getState()
    expect(afterAdd.scene.modules.some(m => m.id === id)).toBe(true)
    expect(afterAdd.dirty).toBe(true)
    expect(afterAdd.canUndo).toBe(true)
    editor.removeModules([id])
    expect(editor.getState().scene.modules.some(m => m.id === id)).toBe(false)
  })

  it('removing a parent detaches children and clears attachments onto it', () => {
    editor.loadScene(fixtureScene([
      mod('rack_1', 'rail', { x: 0.1, y: 0.1, width: 0.4, height: 0.05 }),
      mod('shelf_1', 'shelf', { x: 0.1, y: 0.2 }, { parentId: 'rack_1' }),
      mod('coat_1', 'hangingClothing', { x: 0.15, y: 0.15 }, {
        attachment: { parentId: 'rack_1', pointId: 'hanger-1' },
      }),
    ]))
    editor.removeModules(['rack_1'])
    const modules = editor.getState().scene.modules
    const shelf = modules.find(m => m.id === 'shelf_1')
    const coat = modules.find(m => m.id === 'coat_1')
    expect(modules).toHaveLength(2)
    expect(shelf?.parentId).toBeUndefined()
    expect(coat?.attachment).toBeUndefined()
  })
})

describe('wardrobeStore duplicate', () => {
  it('regenerates ids, clones descendants, remaps internal parentage, offsets +0.03', () => {
    editor.loadScene(fixtureScene())
    const newIds = editor.duplicateModules(['cabinet_1'])
    expect(newIds).toHaveLength(2)
    expect(newIds).not.toContain('cabinet_1')
    expect(newIds).not.toContain('shelf_1')
    const modules = editor.getState().scene.modules
    expect(modules).toHaveLength(5)
    const cabinetClone = modules.find(m => m.id === newIds[0])
    const shelfClone = modules.find(m => m.type === 'shelf' && m.id !== 'shelf_1')
    expect(cabinetClone?.transform.x).toBeCloseTo(0.23, 10)
    expect(cabinetClone?.transform.y).toBeCloseTo(0.23, 10)
    expect(shelfClone).toBeTruthy()
    expect(newIds).toContain(shelfClone!.id)
    expect(shelfClone!.parentId).toBe(cabinetClone!.id)
    expect(shelfClone!.transform.x).toBeCloseTo(0.28, 10)
    expect(editor.getState().selectedIds).toEqual(newIds)
  })
})

describe('wardrobeStore transforms', () => {
  it('one gesture command moves the module and its children together', () => {
    editor.loadScene(fixtureScene())
    const cabinet = editor.getState().scene.modules.find(m => m.id === 'cabinet_1')!
    editor.updateTransforms({
      cabinet_1: { ...cabinet.transform, x: cabinet.transform.x + 0.1, y: cabinet.transform.y + 0.05 },
    })
    const modules = editor.getState().scene.modules
    expect(modules.find(m => m.id === 'cabinet_1')!.transform.x).toBeCloseTo(0.3, 10)
    const shelf = modules.find(m => m.id === 'shelf_1')!
    expect(shelf.transform.x).toBeCloseTo(0.35, 10)
    expect(shelf.transform.y).toBeCloseTo(0.35, 10)
    editor.undo()
    const reverted = editor.getState().scene.modules
    expect(reverted.find(m => m.id === 'cabinet_1')!.transform.x).toBeCloseTo(0.2, 10)
    expect(reverted.find(m => m.id === 'shelf_1')!.transform.x).toBeCloseTo(0.25, 10)
  })

  it('previewTransforms touches only editor state, never scene or history', () => {
    editor.loadScene(fixtureScene())
    const before = sceneJson()
    editor.previewTransforms({ box_1: { x: 0.9, y: 0.9, width: 0.1, height: 0.1, rotation: 0 } })
    expect(editor.getState().gesturePreview?.box_1.x).toBe(0.9)
    expect(sceneJson()).toBe(before)
    expect(editor.getState().canUndo).toBe(false)
    editor.previewTransforms(null)
    expect(editor.getState().gesturePreview).toBeNull()
  })
})

describe('wardrobeStore lock invariants', () => {
  it('rejects direct mutation and deletion while preserving unlock', () => {
    editor.loadScene(fixtureScene([
      mod('locked_1', 'storageBox', { x: 0.2, y: 0.2 }, { locked: true, layer: 2 }),
      mod('other_1', 'cabinet', { x: 0.5, y: 0.5 }),
    ]))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const before = sceneJson()
      const locked = editor.getState().scene.modules.find(m => m.id === 'locked_1')!
      editor.updateTransforms({ locked_1: { ...locked.transform, x: 0.8 } }, 'Move')
      editor.setLayer(['locked_1'], 5)
      editor.setModuleProps('locked_1', { visible: false })
      editor.setParent('locked_1', 'other_1')
      editor.groupModules(['locked_1', 'other_1'])
      editor.removeModules(['locked_1'])
      expect(sceneJson()).toBe(before)
      expect(editor.getState().canUndo).toBe(false)
      expect(warn).toHaveBeenCalled()

      editor.setModuleProps('locked_1', { locked: false })
      expect(editor.getState().scene.modules.find(m => m.id === 'locked_1')?.locked).toBe(false)
      editor.removeModules(['locked_1'])
      expect(editor.getState().scene.modules.some(m => m.id === 'locked_1')).toBe(false)
    } finally {
      warn.mockRestore()
    }
  })

  it('rejects cascading parent operations that would alter a locked descendant', () => {
    editor.loadScene(fixtureScene([
      mod('parent_1', 'cabinet', { x: 0.2, y: 0.2 }),
      mod('child_1', 'shelf', { x: 0.25, y: 0.3 }, { parentId: 'parent_1', locked: true }),
    ]))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const before = sceneJson()
      const parent = editor.getState().scene.modules.find(m => m.id === 'parent_1')!
      editor.updateTransforms({ parent_1: { ...parent.transform, x: 0.4 } }, 'Move')
      editor.removeModules(['parent_1'])
      expect(sceneJson()).toBe(before)
      expect(editor.getState().canUndo).toBe(false)
    } finally {
      warn.mockRestore()
    }
  })
})

describe('wardrobeStore attach/detach', () => {
  it('attaches at a valid point and detach keeps the derived position', () => {
    const combo = findAttachable()
    expect(combo, 'registry must expose at least one attachable point').toBeTruthy()
    const { def, point, childType } = combo!
    editor.loadScene(fixtureScene([
      mod('parent_1', def.type, { x: 0.3, y: 0.3, width: 0.3, height: 0.2 }, { assetId: def.assetId }),
      mod('child_1', childType, { x: 0.7, y: 0.7 }),
    ]))
    editor.attachModule('child_1', { parentId: 'parent_1', pointId: point.id })
    const attached = editor.getState().scene.modules.find(m => m.id === 'child_1')!
    expect(attached.attachment).toEqual({ parentId: 'parent_1', pointId: point.id })
    const hungAt = attached.transform
    editor.detachModule('child_1')
    const detached = editor.getState().scene.modules.find(m => m.id === 'child_1')!
    expect(detached.attachment).toBeUndefined()
    expect(detached.transform).toEqual(hungAt)
    editor.undo()
    expect(editor.getState().scene.modules.find(m => m.id === 'child_1')!.attachment)
      .toEqual({ parentId: 'parent_1', pointId: point.id })
  })

  it('invalid attach no-ops with a console.warn', () => {
    const combo = findAttachable()
    expect(combo, 'registry must expose at least one attachable point').toBeTruthy()
    const { def, childType } = combo!
    editor.loadScene(fixtureScene([
      mod('parent_1', def.type, { x: 0.3, y: 0.3 }, { assetId: def.assetId }),
      mod('ghost_parent', 'cabinet', { x: 0.1, y: 0.1 }, { assetId: 'no_such_asset_zzz' }),
      mod('child_1', childType, { x: 0.7, y: 0.7 }),
    ]))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const before = sceneJson()
      editor.attachModule('child_1', { parentId: 'parent_1', pointId: 'no_such_point_zzz' })
      expect(sceneJson()).toBe(before)
      expect(editor.getState().canUndo).toBe(false)
      editor.attachModule('child_1', { parentId: 'ghost_parent', pointId: 'anything' })
      expect(sceneJson()).toBe(before)
      expect(warn).toHaveBeenCalledTimes(2)
    } finally {
      warn.mockRestore()
    }
  })
})

describe('wardrobeStore parenting', () => {
  it('setParent refuses a cycle and warns', () => {
    editor.loadScene(fixtureScene())
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const before = sceneJson()
      editor.setParent('cabinet_1', 'shelf_1')
      expect(sceneJson()).toBe(before)
      expect(editor.getState().canUndo).toBe(false)
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
    editor.setParent('box_1', 'cabinet_1')
    expect(editor.getState().scene.modules.find(m => m.id === 'box_1')!.parentId).toBe('cabinet_1')
  })
})

describe('wardrobeStore group/ungroup', () => {
  it('grouping wraps members in a bbox container; ungrouping releases them', () => {
    editor.loadScene(fixtureScene())
    editor.groupModules(['cabinet_1', 'box_1'])
    const state = editor.getState()
    const group = state.scene.modules.find(m => m.properties?.isGroup === true)
    expect(group).toBeTruthy()
    expect(group!.type).toBe('divider')
    expect(group!.assetId).toBe('group_container')
    expect(state.selectedIds).toEqual([group!.id])
    expect(group!.transform.x).toBeCloseTo(0.2, 10)
    expect(group!.transform.y).toBeCloseTo(0.2, 10)
    expect(group!.transform.width).toBeCloseTo(0.5, 10)
    expect(group!.transform.height).toBeCloseTo(0.5, 10)
    for (const id of ['cabinet_1', 'box_1']) {
      expect(state.scene.modules.find(m => m.id === id)!.parentId).toBe(group!.id)
    }
    expect(state.scene.modules.find(m => m.id === 'shelf_1')!.parentId).toBe('cabinet_1')
    editor.ungroupModules([group!.id])
    const after = editor.getState().scene.modules
    expect(after.some(m => m.id === group!.id)).toBe(false)
    expect(after.find(m => m.id === 'cabinet_1')!.parentId).toBeUndefined()
    expect(after.find(m => m.id === 'box_1')!.parentId).toBeUndefined()
  })
})

describe('wardrobeStore layers', () => {
  it('setLayer shifts draw order by delta', () => {
    editor.loadScene(fixtureScene())
    editor.setLayer(['box_1', 'shelf_1'], 3)
    const modules = editor.getState().scene.modules
    expect(modules.find(m => m.id === 'box_1')!.layer).toBe(4)
    expect(modules.find(m => m.id === 'shelf_1')!.layer).toBe(3)
    expect(modules.find(m => m.id === 'cabinet_1')!.layer).toBe(0)
    editor.undo()
    expect(editor.getState().scene.modules.find(m => m.id === 'box_1')!.layer).toBe(1)
  })
})

describe('wardrobeStore prefabs', () => {
  const prefab: WardrobePrefab = {
    id: 'prefab_test',
    name: 'Test column',
    modules: [
      {
        temporaryId: 't1',
        type: 'rail',
        assetId: 'rail_asset',
        transform: { x: 0.1, y: 0.1, width: 0.2, height: 0.1, rotation: 0 },
        layer: 0,
      },
      {
        temporaryId: 't2',
        attachment: { parentTemporaryId: 't1', pointId: 'hanger-1' },
        type: 'hangingClothing',
        assetId: 'coat_asset',
        transform: { x: 0.15, y: 0.2, width: 0.05, height: 0.05, rotation: 0 },
        layer: 1,
      },
      {
        temporaryId: 't3',
        parentTemporaryId: 't1',
        type: 'shelf',
        assetId: 'shelf_asset',
        transform: { x: 0.2, y: 0.05, width: 0.1, height: 0.1, rotation: 0 },
        layer: 0,
      },
    ],
  }

  it('regenerates ids, keeps internal parentage/attachments, centres on the point', () => {
    editor.loadScene(fixtureScene([]))
    const newIds = editor.applyPrefab(prefab, { x: 0.5, y: 0.5 })
    expect(newIds).toHaveLength(3)
    const modules = editor.getState().scene.modules
    expect(modules).toHaveLength(3)
    for (const temporary of ['t1', 't2', 't3']) {
      expect(modules.some(m => m.id === temporary)).toBe(false)
    }
    const [railId, coatId, shelfId] = newIds
    const coat = modules.find(m => m.id === coatId)!
    const shelf = modules.find(m => m.id === shelfId)!
    expect(coat.attachment).toEqual({ parentId: railId, pointId: 'hanger-1' })
    expect(shelf.parentId).toBe(railId)
    // Prefab bbox is (0.1,0.05)-(0.3,0.25) → centre (0.2,0.15); dropping at
    // (0.5,0.5) shifts everything by (+0.3,+0.35).
    const rail = modules.find(m => m.id === railId)!
    expect(rail.transform.x).toBeCloseTo(0.4, 10)
    expect(rail.transform.y).toBeCloseTo(0.45, 10)
    expect(editor.getState().selectedIds).toEqual(newIds)
  })
})

describe('wardrobeStore history', () => {
  it('undo x5 across mixed actions restores exact scene JSON; redo x5 replays it', () => {
    editor.loadScene(fixtureScene())
    const initial = sceneJson()
    editor.addModule({
      type: 'plant',
      assetId: 'plant_asset',
      transform: { x: 0.8, y: 0.1, width: 0.05, height: 0.08, rotation: 0 },
      layer: 2,
    })
    const cabinet = editor.getState().scene.modules.find(m => m.id === 'cabinet_1')!
    editor.updateTransforms({ cabinet_1: { ...cabinet.transform, x: cabinet.transform.x + 0.1 } })
    editor.duplicateModules(['box_1'])
    editor.setLayer(['box_1'], 2)
    editor.applyTheme({ primaryColor: '#00FF88', secondaryColor: '#050505', accentColor: '#FF2D9A' })
    const final = sceneJson()
    expect(final).not.toBe(initial)
    for (let i = 0; i < 5; i++) editor.undo()
    expect(sceneJson()).toBe(initial)
    expect(editor.getState().canUndo).toBe(false)
    expect(editor.getState().canRedo).toBe(true)
    for (let i = 0; i < 5; i++) editor.redo()
    expect(sceneJson()).toBe(final)
    expect(editor.getState().canRedo).toBe(false)
    expect(editor.getState().canUndo).toBe(true)
  })

  it('a new action clears the redo stack', () => {
    editor.loadScene(fixtureScene())
    editor.setLayer(['box_1'], 1)
    editor.undo()
    expect(editor.getState().canRedo).toBe(true)
    editor.setLayer(['shelf_1'], 1)
    expect(editor.getState().canRedo).toBe(false)
    const before = sceneJson()
    editor.redo()
    expect(sceneJson()).toBe(before)
  })
})

describe('wardrobeStore persistence errors', () => {
  it('keeps dirty state, surfaces the message, and rejects to the caller', async () => {
    editor.loadScene(fixtureScene())
    editor.setLayer(['box_1'], 1)
    repositoryMocks.saveWardrobeScene.mockRejectedValueOnce(new Error('premium entitlement missing'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await expect(editor.saveWardrobe()).rejects.toThrow('premium entitlement missing')
      expect(editor.getState()).toMatchObject({
        dirty: true,
        saving: false,
        loadError: 'premium entitlement missing',
      })
    } finally {
      warn.mockRestore()
    }
  })
})
