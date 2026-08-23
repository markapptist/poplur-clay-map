import { describe, expect, it } from 'vitest'
import type { WardrobeModule, WardrobeScene, WardrobeTransform } from '../wardrobeTypes'
import { CURRENT_SCENE_VERSION } from '../wardrobeTypes'
import {
  attachModuleCommand,
  detachModuleCommand,
  removeModulesCommand,
  resolveWardrobeTransforms,
  updateTransformsCommand,
} from '../wardrobeCommands'

function transform(overrides: Partial<WardrobeTransform> = {}): WardrobeTransform {
  return { x: 0, y: 0, width: 0.1, height: 0.1, rotation: 0, ...overrides }
}

function attachmentScene(parentTransform: WardrobeTransform): WardrobeScene {
  const modules: WardrobeModule[] = [
    {
      id: 'rail',
      type: 'rail',
      assetId: 'gold_clothing_rail',
      transform: parentTransform,
      layer: 0,
    },
    {
      id: 'coat',
      type: 'hangingClothing',
      assetId: 'jacket_pink',
      // Deliberately stale: attachment data, not this x/y pair, owns the
      // child's position while it is connected.
      transform: transform({ x: 0.02, y: 0.03, width: 0.15, height: 0.24 }),
      layer: 1,
      attachment: { parentId: 'rail', pointId: 'hanger-5' },
    },
  ]
  return {
    id: 'attachment-fixture',
    name: 'Attachment fixture',
    version: CURRENT_SCENE_VERSION,
    canvas: { width: 1000, height: 1000 },
    theme: { primaryColor: '#ff2d9a', secondaryColor: '#111111' },
    modules,
  }
}

describe('wardrobe command attachment geometry', () => {
  it('derives attachment world coordinates through parent resize and rotation', () => {
    const scene = attachmentScene(transform({ x: 0.2, y: 0.2, width: 0.4, height: 0.1 }))
    const changedParent = transform({ x: 0.3, y: 0.1, width: 0.8, height: 0.2, rotation: 90 })
    const world = resolveWardrobeTransforms(scene, { rail: changedParent })

    // hanger-5 is (0.9, 0.55). Before rotation its delta from the resized
    // rail centre is (0.32, 0.01); clockwise 90deg makes that (-0.01, 0.32).
    expect(world.coat.x).toBeCloseTo(0.69, 10)
    expect(world.coat.y).toBeCloseTo(0.52, 10)
    expect(world.coat.width).toBe(0.15)
    expect(world.coat.height).toBe(0.24)
  })

  it('persists derived child coordinates in the same undoable parent transform command', () => {
    const scene = attachmentScene(transform({ x: 0.2, y: 0.2, width: 0.4, height: 0.1 }))
    const changedParent = transform({ x: 0.3, y: 0.1, width: 0.8, height: 0.2, rotation: 90 })
    const command = updateTransformsCommand(scene, { rail: changedParent }, 'Resize and rotate')
    expect(command).toBeTruthy()

    const changed = command!.apply(scene)
    const coat = changed.modules.find(module => module.id === 'coat')!
    expect(coat.transform.x).toBeCloseTo(0.69, 10)
    expect(coat.transform.y).toBeCloseTo(0.52, 10)
    expect(command!.revert(changed).modules).toEqual(scene.modules)
  })

  it('materialises the current derived position before detach or parent removal', () => {
    const scene = attachmentScene(transform({ x: 0.3, y: 0.1, width: 0.8, height: 0.2, rotation: 90 }))
    const detachedScene = detachModuleCommand(scene, 'coat')!.apply(scene)
    const detached = detachedScene.modules.find(module => module.id === 'coat')!
    expect(detached.attachment).toBeUndefined()
    expect(detached.transform.x).toBeCloseTo(0.69, 10)
    expect(detached.transform.y).toBeCloseTo(0.52, 10)

    const removedScene = removeModulesCommand(scene, ['rail'])!.apply(scene)
    const orphan = removedScene.modules.find(module => module.id === 'coat')!
    expect(orphan.attachment).toBeUndefined()
    expect(orphan.transform.x).toBeCloseTo(0.69, 10)
    expect(orphan.transform.y).toBeCloseTo(0.52, 10)
  })

  it('snaps with registry geometry even when a stale coordinate is supplied', () => {
    const bare = attachmentScene(transform({ x: 0.2, y: 0.2, width: 0.4, height: 0.1 }))
    bare.modules[1] = { ...bare.modules[1], attachment: undefined }
    const command = attachModuleCommand(
      bare,
      'coat',
      { parentId: 'rail', pointId: 'hanger-5' },
      transform({ x: 0.99, y: 0.99, width: 0.15, height: 0.24 }),
    )!
    const coat = command.apply(bare).modules.find(module => module.id === 'coat')!
    expect(coat.transform.x).toBeCloseTo(0.56, 10)
    expect(coat.transform.y).toBeCloseTo(0.255, 10)
  })
})

describe('wardrobe command structural hierarchy geometry', () => {
  it('rotates structural children around the parent centre without changing their relative layout', () => {
    const group: WardrobeModule = {
      id: 'group',
      type: 'divider',
      assetId: 'group_container',
      transform: transform({ x: 0.1, y: 0.1, width: 0.4, height: 0.4 }),
      layer: 0,
      properties: { isGroup: true },
    }
    const first: WardrobeModule = {
      id: 'first',
      type: 'storageBox',
      assetId: 'black_storage_box',
      transform: transform({ x: 0.1, y: 0.1, width: 0.1, height: 0.1 }),
      layer: 1,
      parentId: 'group',
    }
    const second: WardrobeModule = {
      ...first,
      id: 'second',
      transform: transform({ x: 0.4, y: 0.4, width: 0.1, height: 0.1 }),
    }
    const scene = attachmentScene(group.transform)
    scene.modules = [group, first, second]
    const rotatedGroup = transform({ x: 0.1, y: 0.1, width: 0.8, height: 0.8, rotation: 90 })
    const command = updateTransformsCommand(scene, { group: rotatedGroup }, 'Resize and rotate group')!
    const changed = command.apply(scene)
    const changedFirst = changed.modules.find(module => module.id === 'first')!
    const changedSecond = changed.modules.find(module => module.id === 'second')!

    // Their old centres occupy opposite (0.125, 0.125)/(0.875, 0.875)
    // parent-local points. Resize ×2 then clockwise rotation keeps those
    // relative points opposite around the new group centre.
    expect(changedFirst.transform).toMatchObject({
      x: expect.closeTo(0.7, 10),
      y: expect.closeTo(0.1, 10),
      width: expect.closeTo(0.2, 10),
      height: expect.closeTo(0.2, 10),
      rotation: expect.closeTo(90, 10),
    })
    expect(changedSecond.transform).toMatchObject({
      x: expect.closeTo(0.1, 10),
      y: expect.closeTo(0.7, 10),
      width: expect.closeTo(0.2, 10),
      height: expect.closeTo(0.2, 10),
      rotation: expect.closeTo(90, 10),
    })
    expect(command.revert(changed).modules).toEqual(scene.modules)
  })

  it('propagates non-uniform resize through nested structural descendants exactly once', () => {
    const root: WardrobeModule = {
      id: 'root',
      type: 'divider',
      assetId: 'group_container',
      transform: transform({ x: 0.1, y: 0.1, width: 0.4, height: 0.4 }),
      layer: 0,
      properties: { isGroup: true },
    }
    const cabinet: WardrobeModule = {
      id: 'cabinet',
      type: 'cabinet',
      assetId: 'vertical_cabinet',
      transform: transform({ x: 0.2, y: 0.2, width: 0.2, height: 0.2 }),
      layer: 1,
      parentId: 'root',
    }
    const shelf: WardrobeModule = {
      id: 'shelf',
      type: 'shelf',
      assetId: 'wood_shelf',
      transform: transform({ x: 0.25, y: 0.25, width: 0.1, height: 0.05 }),
      layer: 2,
      parentId: 'cabinet',
    }
    const scene = attachmentScene(root.transform)
    scene.modules = [root, cabinet, shelf]
    const resizedRoot = transform({ x: 0.1, y: 0.05, width: 0.8, height: 0.6 })
    const changed = updateTransformsCommand(scene, { root: resizedRoot }, 'Resize group')!.apply(scene)

    expect(changed.modules.find(module => module.id === 'cabinet')!.transform).toMatchObject({
      x: expect.closeTo(0.3, 10),
      y: expect.closeTo(0.2, 10),
      width: expect.closeTo(0.4, 10),
      height: expect.closeTo(0.3, 10),
    })
    expect(changed.modules.find(module => module.id === 'shelf')!.transform).toMatchObject({
      x: expect.closeTo(0.4, 10),
      y: expect.closeTo(0.275, 10),
      width: expect.closeTo(0.2, 10),
      height: expect.closeTo(0.075, 10),
    })
  })
})
