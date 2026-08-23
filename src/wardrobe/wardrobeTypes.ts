/**
 * The modular wardrobe system's shared contract. Every wardrobe file builds
 * against this module and nothing else re-declares these shapes.
 *
 * The core principle: THE WARDROBE IS CONFIGURATION DATA. The renderer
 * interprets that data — it contains no wardrobe-specific layout conditions.
 *
 * Coordinates are NORMALISED: x/y/width/height are fractions of the scene
 * canvas (0..1), so one layout adapts across phones, tablets and both
 * orientations. The canvas's width/height fields describe its AUTHORED aspect
 * ratio, not device pixels.
 */

// ---------------------------------------------------------------------------
// Scene model
// ---------------------------------------------------------------------------

export interface WardrobeScene {
  id: string
  ownerId?: string
  name: string
  /** Migration anchor — bump in wardrobeMigrations when the shape changes. */
  version: number
  templateId?: string
  canvas: WardrobeCanvas
  theme: WardrobeTheme
  modules: WardrobeModule[]
  createdAt?: unknown
  updatedAt?: unknown
}

export interface WardrobeCanvas {
  /** Authored design size — establishes aspect ratio for normalised coords. */
  width: number
  height: number
  backgroundColor?: string
  backgroundAssetId?: string
  /** Normalised (0..1) inset kept clear of the scene edges. */
  safeAreaPadding?: number
}

export interface WardrobeTheme {
  primaryColor: string
  secondaryColor: string
  accentColor?: string
  woodColor?: string
  metalColor?: string
  lightingStyle?: string
  visualQuality?: 'low' | 'medium' | 'high'
}

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

export type WardrobeModuleType =
  | 'wardrobeFrame'
  | 'wardrobeDoor'
  | 'divider'
  | 'shelf'
  | 'drawer'
  | 'cabinet'
  | 'rail'
  | 'hook'
  | 'shoeRack'
  | 'storageBox'
  | 'mirror'
  | 'rug'
  | 'hangingClothing'
  | 'foldedClothing'
  | 'shoe'
  | 'hat'
  | 'handbag'
  | 'jewelry'
  | 'perfume'
  | 'cosmetic'
  | 'plant'
  | 'decoration'
  | 'trophy'
  | 'light'
  | 'particleEffect'
  | 'character'
  | 'background'
  | 'floor'

export interface WardrobeTransform {
  /** Normalised (0..1) position of the module's anchor within the canvas. */
  x: number
  y: number
  /** Normalised (0..1) size relative to the canvas. */
  width: number
  height: number
  /** Degrees, clockwise. */
  rotation: number
  scaleX?: number
  scaleY?: number
}

export interface WardrobeAttachment {
  parentId: string
  pointId: string
}

export interface WardrobeModule {
  id: string
  type: WardrobeModuleType
  assetId: string
  /** Structural containment (a shelf belongs to a cabinet). Transform is
      still scene-space; parentage drives group movement and layers-panel
      nesting, not coordinate spaces. */
  parentId?: string
  /** Slot attachment (a jacket hangs on rail point "hanger-2"). Position is
      DERIVED from the point while attached; transform.x/y are refreshed on
      every parent move so detaching leaves the module where it hung. */
  attachment?: WardrobeAttachment
  transform: WardrobeTransform
  /** Draw order — higher draws on top. Ties break by array order. */
  layer: number
  opacity?: number
  visible?: boolean
  locked?: boolean
  /** CSS colour multiplied onto tintable assets. */
  tint?: string
  animation?: {
    name: string
    autoplay?: boolean
    loop?: boolean
    speed?: number
  }
  /** Type-specific extras (e.g. character appearance lives here under
      `appearance`, lights carry `intensity`). */
  properties?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Asset registry
// ---------------------------------------------------------------------------

export interface WardrobeAttachmentPointDef {
  id: string
  /** Normalised within the PARENT module's box (0..1). */
  x: number
  y: number
  allowedTypes: WardrobeModuleType[]
}

export interface WardrobeAssetDefinition {
  assetId: string
  name: string
  type: WardrobeModuleType
  /** Path under the app's public root (Vite BASE_URL-relative). */
  source: string
  thumbnailSource?: string
  /** Authored pixel size — establishes the asset's natural aspect ratio. */
  defaultWidth: number
  defaultHeight: number
  resizable: boolean
  rotatable: boolean
  tintable: boolean
  /** Which module types this asset may parent/attach into. */
  compatibleParents?: WardrobeModuleType[]
  allowedAttachmentTypes?: string[]
  /** Attachment points this asset EXPOSES to children (rails, shelves…). */
  attachmentPoints?: WardrobeAttachmentPointDef[]
  anchor?: 'topLeft' | 'center' | 'bottomCenter'
  premium?: boolean
  category?: string
  tags?: string[]
}

// ---------------------------------------------------------------------------
// Prefabs
// ---------------------------------------------------------------------------

export interface WardrobePrefabModule {
  temporaryId: string
  parentTemporaryId?: string
  attachment?: { parentTemporaryId: string, pointId: string }
  type: WardrobeModuleType
  assetId: string
  transform: WardrobeTransform
  layer: number
  properties?: Record<string, unknown>
}

export interface WardrobePrefab {
  id: string
  name: string
  description?: string
  previewImage?: string
  category?: string
  modules: WardrobePrefabModule[]
}

// ---------------------------------------------------------------------------
// Character
// ---------------------------------------------------------------------------

/** Wardrobe-scene character appearance. Bridges to the app-wide character
    (characterStore.PoplurCharacter) via wardrobeCharacter.ts, and is designed
    so the renderer behind CharacterModule can later be swapped for layered
    2D sheets, sprites, 3D, or a server-rendered image without touching scene
    data. Stored in a character module's properties.appearance. */
export interface WardrobeCharacterAppearance {
  characterId: string
  skinToneId: string
  faceId: string
  hairId: string
  eyeId: string
  eyebrowId: string
  glassesId?: string
  topId: string
  bottomId: string
  shoeId: string
  accessoryIds: string[]
  poseId: string
  expressionId: string
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type WardrobeValidationCode =
  | 'missing-asset'
  | 'unknown-module-type'
  | 'invalid-parent'
  | 'circular-parent'
  | 'invalid-attachment-parent'
  | 'invalid-attachment-point'
  | 'incompatible-attachment'
  | 'out-of-bounds'
  | 'below-minimum-size'
  | 'above-maximum-size'
  | 'locked-module'
  | 'premium-not-owned'
  | 'malformed-scene'
  | 'module-limit-exceeded'

export interface WardrobeValidationIssue {
  code: WardrobeValidationCode
  moduleId?: string
  message: string
  /** Errors block the operation; warnings render with a dev-console notice. */
  severity: 'error' | 'warning'
}

export interface WardrobeValidationResult {
  ok: boolean
  issues: WardrobeValidationIssue[]
}

/** Hard limits the validator enforces. */
export const WARDROBE_LIMITS = {
  maxModules: 250,
  /** Normalised minimum footprint — below this a touch target is unusable. */
  minSize: 0.015,
  maxSize: 1.5,
} as const

// ---------------------------------------------------------------------------
// Editor state and commands
// ---------------------------------------------------------------------------

/** Undo/redo unit. Commands are pure data transforms scene → scene so the
    history is replayable and nothing mutates in place. */
export interface WardrobeCommand {
  label: string
  apply(scene: WardrobeScene): WardrobeScene
  revert(scene: WardrobeScene): WardrobeScene
}

export interface WardrobeEditorState {
  scene: WardrobeScene
  selectedIds: string[]
  /** Live gesture overlay — transforms previewed here are NOT committed to
      the scene until the gesture ends (one command per gesture, never one
      per frame). */
  gesturePreview: Record<string, WardrobeTransform> | null
  /** Attachment point highlighted as the current snap candidate. */
  snapCandidate: { parentId: string, pointId: string } | null
  canUndo: boolean
  canRedo: boolean
  mode: 'edit' | 'preview'
  dirty: boolean
  saving: boolean
  loadError: string | null
}

/** The single editor API every panel talks to. Implemented by
    wardrobeStore.ts as a module singleton with useSyncExternalStore-based
    React subscription (the project's store convention, no new state deps). */
export interface WardrobeEditorApi {
  getState(): WardrobeEditorState
  subscribe(listener: () => void): () => void

  loadScene(scene: WardrobeScene): void
  newScene(name: string): void

  addModule(module: Omit<WardrobeModule, 'id'>): string
  removeModules(ids: string[]): void
  duplicateModules(ids: string[]): string[]
  /** Commits one undoable transform command (call at gesture END). */
  updateTransforms(patch: Record<string, WardrobeTransform>, label?: string): void
  /** Frame-rate gesture path — preview only, no history, no persistence. */
  previewTransforms(patch: Record<string, WardrobeTransform> | null): void
  setSnapCandidate(candidate: { parentId: string, pointId: string } | null): void

  attachModule(id: string, attachment: WardrobeAttachment): void
  detachModule(id: string): void
  setParent(id: string, parentId: string | undefined): void
  setLayer(ids: string[], delta: number): void
  setModuleProps(id: string, patch: Partial<Pick<WardrobeModule, 'opacity' | 'visible' | 'locked' | 'tint' | 'assetId' | 'animation' | 'properties'>>): void

  groupModules(ids: string[]): void
  ungroupModules(ids: string[]): void
  applyPrefab(prefab: WardrobePrefab, at: { x: number, y: number }): string[]
  applyTheme(theme: WardrobeTheme): void

  select(ids: string[]): void
  setMode(mode: 'edit' | 'preview'): void

  undo(): void
  redo(): void

  saveWardrobe(): Promise<void>
  loadWardrobe(wardrobeId: string): Promise<void>
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export interface WardrobeDocument {
  name: string
  ownerId: string
  templateId?: string
  sceneVersion: number
  /** Canonical registry-derived premium assets referenced by the inline scene.
      Firestore rules use this bounded declaration to require entitlements. */
  premiumAssetIds?: string[]
  thumbnailURL?: string
  isPublic: boolean
  createdAt: unknown
  updatedAt: unknown
}

/** Firestore layout (see wardrobeRepository.ts):
    wardrobeAssets/{assetId}
    wardrobePrefabs/{prefabId}
    wardrobeTemplates/{templateId}
    users/{userId}/wardrobes/{wardrobeId}         — WardrobeDocument + scene
    users/{userId}/wardrobeInventory/{itemId}     — premium entitlements */
export const WARDROBE_COLLECTIONS = {
  assets: 'wardrobeAssets',
  prefabs: 'wardrobePrefabs',
  templates: 'wardrobeTemplates',
  userWardrobes: (uid: string) => `users/${uid}/wardrobes`,
  userInventory: (uid: string) => `users/${uid}/wardrobeInventory`,
} as const

export const CURRENT_SCENE_VERSION = 1

/** Stable id factory shared by store, prefabs and tests. */
export function wardrobeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
