import type { WardrobePrefab } from '../wardrobeTypes'

// Prefab transforms are authored near the origin; applyPrefab offsets the
// whole group to its drop point and mints real ids from the temporaryIds.

export const accessoriesColumnPrefab: WardrobePrefab = {
  id: 'prefab_accessories_column_01',
  name: 'Poplur Accessories Column',
  description: 'A slim cabinet with two display shelves holding a handbag, a necklace and a trophy.',
  category: 'storage',
  modules: [
    {
      temporaryId: 'column_cabinet',
      type: 'cabinet',
      assetId: 'vertical_cabinet',
      transform: { x: 0, y: 0, width: 0.24, height: 0.56, rotation: 0 },
      layer: 10,
    },
    {
      temporaryId: 'column_shelf_upper',
      parentTemporaryId: 'column_cabinet',
      type: 'shelf',
      assetId: 'wood_shelf',
      transform: { x: 0.02, y: 0.16, width: 0.20, height: 0.014, rotation: 0 },
      layer: 11,
    },
    {
      temporaryId: 'column_shelf_lower',
      parentTemporaryId: 'column_cabinet',
      type: 'shelf',
      assetId: 'wood_shelf',
      transform: { x: 0.02, y: 0.36, width: 0.20, height: 0.014, rotation: 0 },
      layer: 11,
    },
    {
      temporaryId: 'column_handbag',
      type: 'handbag',
      assetId: 'pink_poplur_handbag',
      attachment: { parentTemporaryId: 'column_shelf_upper', pointId: 'surface-1' },
      transform: { x: 0.03, y: 0.09, width: 0.06, height: 0.07, rotation: 0 },
      layer: 20,
    },
    {
      temporaryId: 'column_necklace',
      type: 'jewelry',
      assetId: 'gold_poplur_necklace',
      attachment: { parentTemporaryId: 'column_shelf_upper', pointId: 'surface-3' },
      transform: { x: 0.16, y: 0.10, width: 0.04, height: 0.06, rotation: 0 },
      layer: 20,
    },
    {
      temporaryId: 'column_trophy',
      type: 'trophy',
      assetId: 'poplur_trophy',
      attachment: { parentTemporaryId: 'column_shelf_lower', pointId: 'surface-2' },
      transform: { x: 0.09, y: 0.285, width: 0.05, height: 0.07, rotation: 0 },
      layer: 20,
    },
  ],
}
