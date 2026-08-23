import type { WardrobeCharacterAppearance, WardrobeModule, WardrobeScene, WardrobeTransform } from '../wardrobeTypes'
import { CURRENT_SCENE_VERSION } from '../wardrobeTypes'

// The starter closet is pure configuration data. Ids are FIXED (not
// wardrobeId()) so two calls are structurally equal; every call still builds
// fresh objects so no caller can mutate another's scene.

const t = (x: number, y: number, width: number, height: number, rotation = 0): WardrobeTransform =>
  ({ x, y, width, height, rotation })

export function pinkStarterCloset(): WardrobeScene {
  const appearance: WardrobeCharacterAppearance = {
    characterId: 'poplur-default',
    skinToneId: 'skin-01',
    faceId: 'face-01',
    hairId: 'hair-long',
    eyeId: 'eyes-brown',
    eyebrowId: 'brows-soft',
    topId: 'top-pink-tee',
    bottomId: 'bottom-black-jeans',
    shoeId: 'shoes-pink-sneakers',
    accessoryIds: [],
    poseId: 'stand',
    expressionId: 'smile',
  }

  // The photographic room supplies the exact reference architecture. Only
  // transparent cuts and the live character are modules, so every overlay
  // remains independently selectable, movable, and deletable.
  const modules: WardrobeModule[] = [
    {
      id: 'psc_hair_piece',
      type: 'hat',
      assetId: 'long_pink_highlight_hair',
      transform: t(0.245, 0.024, 0.13, 0.156),
      layer: 20,
    },
    {
      id: 'psc_jacket_black',
      type: 'hangingClothing',
      assetId: 'black_poplur_jacket',
      transform: t(0.225, 0.215, 0.17, 0.15),
      layer: 20,
    },
    {
      id: 'psc_pants_black',
      type: 'hangingClothing',
      assetId: 'black_poplur_pants',
      transform: t(0.415, 0.215, 0.14, 0.123),
      layer: 20,
    },
    {
      id: 'psc_shoes_black',
      type: 'shoe',
      assetId: 'black_pink_shoes',
      transform: t(0.235, 0.635, 0.16, 0.139),
      layer: 20,
    },
    {
      id: 'psc_glasses',
      type: 'jewelry',
      assetId: 'black_poplur_glasses',
      transform: t(0.685, 0.17, 0.14, 0.166),
      layer: 21,
    },
    {
      id: 'psc_necklace',
      type: 'jewelry',
      assetId: 'gold_poplur_necklace',
      transform: t(0.685, 0.295, 0.14, 0.103),
      layer: 21,
    },
    {
      id: 'psc_earrings',
      type: 'jewelry',
      assetId: 'silver_poplur_earrings',
      transform: t(0.685, 0.405, 0.14, 0.101),
      layer: 21,
    },
    {
      id: 'psc_phone',
      type: 'decoration',
      assetId: 'black_poplur_phone',
      transform: t(0.69, 0.515, 0.13, 0.093),
      layer: 21,
    },
    {
      // poplur_character is bottomCenter anchored. Its authored box matches
      // the live ClayCharacter aspect, preventing the full body from clipping.
      id: 'psc_character',
      type: 'character',
      assetId: 'poplur_character',
      transform: t(0.5, 0.885, 0.34, 0.43),
      layer: 30,
      properties: { appearance },
    },
  ]

  return {
    id: 'wardrobe_pink_starter_01',
    name: 'Pink Poplur Starter Closet',
    version: CURRENT_SCENE_VERSION,
    canvas: {
      // Match the photographic source exactly: no crop, stretch, or duplicated
      // CSS carcass around the open wardrobe.
      width: 625,
      height: 753,
      backgroundColor: '#140A0D',
      backgroundAssetId: 'poplur_wardrobe_room',
      safeAreaPadding: 0.02,
    },
    theme: {
      primaryColor: '#FF2D9A',
      secondaryColor: '#111111',
      accentColor: '#FFD3EA',
      woodColor: '#A85F3E',
      metalColor: '#D7A64A',
      lightingStyle: 'warmPink',
      visualQuality: 'high',
    },
    modules,
  }
}
