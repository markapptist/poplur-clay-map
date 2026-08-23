import { describe, expect, it } from 'vitest'
import { migrateWardrobeScene } from '../wardrobeMigrations'
import { wardrobeEditor } from '../wardrobeStore'
import { CURRENT_SCENE_VERSION } from '../wardrobeTypes'
import { accessoriesColumnPrefab } from '../samples/accessoriesColumn'

/** One user-shaped flow through the public editor API. The lower-level suites
    probe edge cases; this guards that migration, commands, registry-backed
    attachment, history and prefabs continue to compose as one session. */
describe('wardrobe editor end-to-end flow', () => {
  it('migrates, adds, moves/resizes, attaches, duplicates, deletes, groups and applies a prefab with history', () => {
    const migrated = migrateWardrobeScene({
      id: 'legacy-wardrobe',
      name: 'Imported wardrobe',
      canvas: { width: 1000, height: 1000 },
      theme: { primaryColor: '#ff2d9a', secondaryColor: '#111111' },
      modules: [
        {
          id: 'legacy-rail',
          type: 'rail',
          assetId: 'gold_clothing_rail',
          transform: { x: 100, y: 120, width: 500, height: 40, rotation: 0 },
          layer: 1,
        },
      ],
    })

    expect(migrated.version).toBe(CURRENT_SCENE_VERSION)
    expect(migrated.modules[0].transform).toMatchObject({ x: 0.1, y: 0.12, width: 0.5, height: 0.04 })
    wardrobeEditor.loadScene(migrated)

    const jacketId = wardrobeEditor.addModule({
      type: 'hangingClothing',
      assetId: 'pink_poplur_jacket',
      transform: { x: 0.72, y: 0.34, width: 0.08, height: 0.18, rotation: 0 },
      layer: 3,
    })
    expect(wardrobeEditor.getState().scene.modules.some(module => module.id === jacketId)).toBe(true)

    wardrobeEditor.updateTransforms({
      [jacketId]: { x: 0.64, y: 0.28, width: 0.12, height: 0.24, rotation: 0 },
    }, 'Move and resize')
    expect(wardrobeEditor.getState().scene.modules.find(module => module.id === jacketId)?.transform)
      .toMatchObject({ x: 0.64, y: 0.28, width: 0.12, height: 0.24 })

    wardrobeEditor.attachModule(jacketId, { parentId: 'legacy-rail', pointId: 'hanger-3' })
    const attached = wardrobeEditor.getState().scene.modules.find(module => module.id === jacketId)!
    expect(attached.attachment).toEqual({ parentId: 'legacy-rail', pointId: 'hanger-3' })
    expect(attached.transform.x).toBeCloseTo(0.35, 10)
    expect(attached.transform.y).toBeCloseTo(0.142, 10)

    const [duplicateId] = wardrobeEditor.duplicateModules([jacketId])
    expect(duplicateId).toBeTruthy()
    const duplicate = wardrobeEditor.getState().scene.modules.find(module => module.id === duplicateId)!
    expect(duplicate.assetId).toBe('pink_poplur_jacket')
    expect(duplicate.attachment).toBeUndefined()

    const beforeDelete = JSON.stringify(wardrobeEditor.getState().scene)
    wardrobeEditor.removeModules([duplicateId])
    expect(wardrobeEditor.getState().scene.modules.some(module => module.id === duplicateId)).toBe(false)
    wardrobeEditor.undo()
    expect(JSON.stringify(wardrobeEditor.getState().scene)).toBe(beforeDelete)
    wardrobeEditor.redo()
    expect(wardrobeEditor.getState().scene.modules.some(module => module.id === duplicateId)).toBe(false)
    wardrobeEditor.undo()

    wardrobeEditor.groupModules([jacketId, duplicateId])
    const group = wardrobeEditor.getState().scene.modules.find(module => module.properties?.isGroup === true)
    expect(group).toBeDefined()
    expect(wardrobeEditor.getState().scene.modules.find(module => module.id === jacketId)?.parentId).toBe(group!.id)
    expect(wardrobeEditor.getState().scene.modules.find(module => module.id === duplicateId)?.parentId).toBe(group!.id)

    const prefabIds = wardrobeEditor.applyPrefab(accessoriesColumnPrefab, { x: 0.68, y: 0.52 })
    expect(prefabIds).toHaveLength(accessoriesColumnPrefab.modules.length)
    expect(new Set(prefabIds).size).toBe(prefabIds.length)
    expect(wardrobeEditor.getState().selectedIds).toEqual(prefabIds)
    const prefabModules = wardrobeEditor.getState().scene.modules.filter(module => prefabIds.includes(module.id))
    expect(prefabModules.some(module => module.parentId && prefabIds.includes(module.parentId))).toBe(true)
    expect(prefabModules.some(module => module.attachment && prefabIds.includes(module.attachment.parentId))).toBe(true)
  })
})
