/**
 * Wardrobe persistence over the web Firebase client (webFirebase.ts).
 *
 * Layout (see WARDROBE_COLLECTIONS):
 *   users/{uid}/wardrobes/{id}        — WardrobeDocument fields + `scene`
 *   users/{uid}/wardrobeInventory/{a} — premium entitlements (server-written)
 *
 * The whole scene is stored INLINE in the wardrobe document: modules live in
 * the `scene.modules` array, not a subcollection, so a wardrobe loads in one
 * read. WARDROBE_LIMITS.maxModules (250) keeps the document comfortably under
 * Firestore's 1MB cap. Escape hatch if scenes ever outgrow that: shard modules
 * into users/{uid}/wardrobes/{id}/modules/{moduleId} docs written with
 * writeBatch and keep only the scene header inline — the read path then
 * reassembles modules from getDocs over the subcollection.
 *
 * webDb()/currentUid() are read LAZILY inside each network function, never at
 * module scope, so importing this module under node/vitest touches no Firebase
 * state.
 */

import {
  collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc,
  type Firestore,
} from 'firebase/firestore'
import { currentUid, webDb } from '../webFirebase'
import { wardrobeAssetRegistry } from './wardrobeAssets'
import { validateScene } from './wardrobeValidation'
import {
  CURRENT_SCENE_VERSION, WARDROBE_COLLECTIONS, WARDROBE_LIMITS, wardrobeId,
} from './wardrobeTypes'
import type {
  WardrobeAttachment, WardrobeCanvas, WardrobeDocument, WardrobeModule,
  WardrobeModuleType, WardrobeScene, WardrobeTheme, WardrobeTransform,
  WardrobeValidationIssue,
} from './wardrobeTypes'

// Generic string safety cap — the rules layer enforces the tighter per-field
// policies (e.g. document name < 100).
const MAX_STRING = 500

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  return v.length > MAX_STRING ? v.slice(0, MAX_STRING) : v
}

function num(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isNaN(n) ? undefined : n
}

function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

/** JSON-safe deep copy for `properties`: functions/undefined/symbols drop out,
    NaN drops out, long strings truncate. Cycles drop rather than throw; `seen`
    tracks only the CURRENT path so shared (diamond) references survive like
    they do under JSON.stringify. */
function cleanValue(v: unknown, seen: WeakSet<object>): unknown {
  if (v === null) return null
  if (typeof v === 'string') return v.length > MAX_STRING ? v.slice(0, MAX_STRING) : v
  if (typeof v === 'number') return Number.isNaN(v) ? undefined : v
  if (typeof v === 'boolean') return v
  if (typeof v !== 'object') return undefined
  const obj = v as object
  if (seen.has(obj)) return undefined
  seen.add(obj)
  let out: unknown
  if (Array.isArray(obj)) {
    // undefined entries become null, matching JSON.stringify array semantics
    out = obj.map(item => cleanValue(item, seen) ?? null)
  } else {
    const rec: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(obj)) {
      const c = cleanValue(val, seen)
      if (c !== undefined) rec[k] = c
    }
    out = rec
  }
  seen.delete(obj)
  return out
}

function sanitizeCanvas(raw: unknown): WardrobeCanvas {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const backgroundColor = str(c.backgroundColor)
  const backgroundAssetId = str(c.backgroundAssetId)
  const safeAreaPadding = num(c.safeAreaPadding)
  return {
    width: num(c.width) ?? 1,
    height: num(c.height) ?? 1,
    ...(backgroundColor !== undefined && { backgroundColor }),
    ...(backgroundAssetId !== undefined && { backgroundAssetId }),
    ...(safeAreaPadding !== undefined && { safeAreaPadding }),
  }
}

function sanitizeTheme(raw: unknown): WardrobeTheme {
  const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const accentColor = str(t.accentColor)
  const woodColor = str(t.woodColor)
  const metalColor = str(t.metalColor)
  const lightingStyle = str(t.lightingStyle)
  const quality = t.visualQuality
  const visualQuality = quality === 'low' || quality === 'medium' || quality === 'high'
    ? quality
    : undefined
  return {
    primaryColor: str(t.primaryColor) ?? '',
    secondaryColor: str(t.secondaryColor) ?? '',
    ...(accentColor !== undefined && { accentColor }),
    ...(woodColor !== undefined && { woodColor }),
    ...(metalColor !== undefined && { metalColor }),
    ...(lightingStyle !== undefined && { lightingStyle }),
    ...(visualQuality !== undefined && { visualQuality }),
  }
}

function sanitizeTransform(raw: unknown): WardrobeTransform {
  const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const scaleX = num(t.scaleX)
  const scaleY = num(t.scaleY)
  return {
    x: num(t.x) ?? 0,
    y: num(t.y) ?? 0,
    width: num(t.width) ?? 0,
    height: num(t.height) ?? 0,
    rotation: num(t.rotation) ?? 0,
    ...(scaleX !== undefined && { scaleX }),
    ...(scaleY !== undefined && { scaleY }),
  }
}

function sanitizeAttachment(raw: unknown): WardrobeAttachment | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const a = raw as Record<string, unknown>
  const parentId = str(a.parentId)
  const pointId = str(a.pointId)
  if (parentId === undefined || pointId === undefined) return undefined
  return { parentId, pointId }
}

function sanitizeAnimation(raw: unknown): WardrobeModule['animation'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const a = raw as Record<string, unknown>
  const name = str(a.name)
  if (name === undefined) return undefined
  const autoplay = bool(a.autoplay)
  const loop = bool(a.loop)
  const speed = num(a.speed)
  return {
    name,
    ...(autoplay !== undefined && { autoplay }),
    ...(loop !== undefined && { loop }),
    ...(speed !== undefined && { speed }),
  }
}

function sanitizeModule(raw: unknown): WardrobeModule | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const m = raw as Record<string, unknown>
  const parentId = str(m.parentId)
  const attachment = sanitizeAttachment(m.attachment)
  const opacity = num(m.opacity)
  const visible = bool(m.visible)
  const locked = bool(m.locked)
  const tint = str(m.tint)
  const animation = sanitizeAnimation(m.animation)
  const properties = m.properties && typeof m.properties === 'object' && !Array.isArray(m.properties)
    ? cleanValue(m.properties, new WeakSet()) as Record<string, unknown>
    : undefined
  return {
    id: str(m.id) ?? '',
    // A junk type sanitizes to '' and is flagged by validateScene as
    // unknown-module-type — sanitize never guesses a real type for it.
    type: (str(m.type) ?? '') as WardrobeModuleType,
    assetId: str(m.assetId) ?? '',
    ...(parentId !== undefined && { parentId }),
    ...(attachment && { attachment }),
    transform: sanitizeTransform(m.transform),
    layer: num(m.layer) ?? 0,
    ...(opacity !== undefined && { opacity }),
    ...(visible !== undefined && { visible }),
    ...(locked !== undefined && { locked }),
    ...(tint !== undefined && { tint }),
    ...(animation && { animation }),
    ...(properties && { properties }),
  }
}

/**
 * Pure whitelist copy of a scene: only known WardrobeScene/WardrobeModule
 * fields survive, functions and undefined drop, numeric fields coerce via
 * Number (NaN drops), strings over 500 chars truncate, and modules cap at
 * WARDROBE_LIMITS.maxModules. Never throws on junk input.
 *
 * scene.createdAt/updatedAt are intentionally dropped: the document-level
 * serverTimestamp fields own that data, and Timestamp/sentinel objects must
 * not be deep-copied.
 */
export function sanitizeScene(scene: WardrobeScene): WardrobeScene {
  const s = (scene && typeof scene === 'object' ? scene : {}) as unknown as Record<string, unknown>
  const rawModules = Array.isArray(s.modules) ? s.modules : []
  const all = rawModules
    .map(sanitizeModule)
    .filter((m): m is WardrobeModule => m !== null)
  const overflow = all.length - WARDROBE_LIMITS.maxModules
  if (overflow > 0) {
    console.warn(`sanitizeScene: dropped ${overflow} modules over the ${WARDROBE_LIMITS.maxModules}-module limit`)
  }
  const modules = overflow > 0 ? all.slice(0, WARDROBE_LIMITS.maxModules) : all
  const ownerId = str(s.ownerId)
  const templateId = str(s.templateId)
  return {
    id: str(s.id) ?? '',
    ...(ownerId !== undefined && { ownerId }),
    name: str(s.name) ?? '',
    version: num(s.version) ?? CURRENT_SCENE_VERSION,
    ...(templateId !== undefined && { templateId }),
    canvas: sanitizeCanvas(s.canvas),
    theme: sanitizeTheme(s.theme),
    modules,
  }
}

/** A typed failure that callers can surface directly in the editor. Warnings
    (for example a future asset unknown to this older client) do not block a
    save; every validation error does. */
export class WardrobeSaveValidationError extends Error {
  readonly issues: WardrobeValidationIssue[]

  constructor(issues: WardrobeValidationIssue[]) {
    const summary = issues.slice(0, 3).map(item => item.message).join('; ')
    const remainder = issues.length > 3 ? `; plus ${issues.length - 3} more` : ''
    super(`wardrobe cannot be saved: ${summary}${remainder}`)
    this.name = 'WardrobeSaveValidationError'
    this.issues = issues
  }
}

/** Premium ids actually referenced by this scene, derived from the canonical
    registry rather than trusting a caller-supplied claim. */
export function premiumAssetIdsInScene(scene: WardrobeScene): string[] {
  const ids = new Set<string>()
  for (const module of scene.modules) {
    if (wardrobeAssetRegistry[module.assetId]?.premium) ids.add(module.assetId)
  }
  return [...ids].sort()
}

/** Pure validation boundary shared by production save and node tests. */
export function assertWardrobeSceneSaveable(
  scene: WardrobeScene,
  ownedPremium: Set<string>,
): void {
  const result = validateScene(scene, { registry: wardrobeAssetRegistry, ownedPremium })
  const errors = result.issues.filter(item => item.severity === 'error')
  if (errors.length) throw new WardrobeSaveValidationError(errors)
}

async function loadOwnedPremiumAssetIds(
  db: Firestore,
  uid: string,
  requiredIds: string[],
): Promise<Set<string>> {
  if (requiredIds.length === 0) return new Set()
  const snapshots = await Promise.all(requiredIds.map(assetId =>
    getDoc(doc(db, WARDROBE_COLLECTIONS.userInventory(uid), assetId))))
  return new Set(requiredIds.filter((_, index) => snapshots[index].exists()))
}

export async function saveWardrobeScene(scene: WardrobeScene): Promise<string> {
  const uid = currentUid()
  if (!uid) throw new Error('sign in to save wardrobes')
  const db = webDb()
  const clean = sanitizeScene(scene)
  const id = clean.id || wardrobeId('wardrobe')
  clean.id = id
  clean.ownerId = uid
  const premiumAssetIds = premiumAssetIdsInScene(clean)

  // Reject malformed structure before spending entitlement reads. Treat the
  // scene's declared premium ids as owned for this first pass; the second pass
  // below supplies only inventory documents that actually exist.
  assertWardrobeSceneSaveable(clean, new Set(premiumAssetIds))
  const ownedPremium = await loadOwnedPremiumAssetIds(db, uid, premiumAssetIds)
  assertWardrobeSceneSaveable(clean, ownedPremium)

  const ref = doc(db, WARDROBE_COLLECTIONS.userWardrobes(uid), id)
  const existing = await getDoc(ref)
  const fields: Record<string, unknown> = {
    name: clean.name,
    ownerId: uid,
    sceneVersion: clean.version,
    premiumAssetIds,
    updatedAt: serverTimestamp(),
    scene: clean,
  }
  if (clean.templateId !== undefined) fields.templateId = clean.templateId
  if (!existing.exists()) {
    fields.createdAt = serverTimestamp()
    fields.isPublic = false
  }
  await setDoc(ref, fields, { merge: true })
  return id
}

/** Returns the RAW stored scene — the caller runs migrateWardrobeScene. */
export async function loadWardrobeScene(id: string): Promise<WardrobeScene> {
  const uid = currentUid()
  if (!uid) throw new Error('sign in to load wardrobes')
  const snap = await getDoc(doc(webDb(), WARDROBE_COLLECTIONS.userWardrobes(uid), id))
  if (!snap.exists()) throw new Error(`wardrobe "${id}" not found`)
  const scene = snap.data().scene
  if (!scene || typeof scene !== 'object') throw new Error(`wardrobe "${id}" has no scene data`)
  return scene as WardrobeScene
}

export async function listWardrobes(): Promise<{ id: string, doc: WardrobeDocument }[]> {
  const uid = currentUid()
  if (!uid) throw new Error('sign in to list wardrobes')
  const snap = await getDocs(collection(webDb(), WARDROBE_COLLECTIONS.userWardrobes(uid)))
  return snap.docs.map(d => {
    // The inline scene is the heavy part of the document — a listing only
    // needs the WardrobeDocument header fields.
    const { scene: _scene, ...header } = d.data()
    return { id: d.id, doc: header as WardrobeDocument }
  })
}

export async function deleteWardrobe(id: string): Promise<void> {
  const uid = currentUid()
  if (!uid) throw new Error('sign in to delete wardrobes')
  await deleteDoc(doc(webDb(), WARDROBE_COLLECTIONS.userWardrobes(uid), id))
}

/** Entitlement docs are written server-side only (see firestore-wardrobe.rules);
    existence of users/{uid}/wardrobeInventory/{assetId} IS ownership. */
export async function ownsPremiumAsset(assetId: string): Promise<boolean> {
  const uid = currentUid()
  if (!uid) return false
  const snap = await getDoc(doc(webDb(), WARDROBE_COLLECTIONS.userInventory(uid), assetId))
  return snap.exists()
}
