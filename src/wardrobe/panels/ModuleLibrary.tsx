import { useMemo, useRef, useState, type CSSProperties } from 'react'
import styles from './panels.module.css'
import type { WardrobeAssetDefinition, WardrobePrefab } from '../wardrobeTypes'
import { useWardrobeEditor, useWardrobeEditorApi } from '../wardrobeStore'
import {
  assetSource,
  hasWardrobeAssetArt,
  wardrobeAssetRegistry,
  wardrobeFallbackGlyph,
  wardrobeFallbackTone,
  WARDROBE_CATEGORIES,
} from '../wardrobeAssets'
import { accessoriesColumnPrefab } from '../samples/accessoriesColumn'
import { playPop } from '../../pop'

const RECENTS_KEY = 'poplur.wardrobe.recentAssets'
const CUSTOM_PREFABS_KEY = 'poplur.wardrobe.customPrefabs'
const RECENTS_MAX = 12
/** Asset defaultWidth/Height are authored pixels; scene coords are fractions,
    so placement normalises against this reference canvas width. */
const REFERENCE_CANVAS_WIDTH = 1080
const MAX_PLACED_WIDTH = 0.4

function readRecents(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string').slice(0, RECENTS_MAX)
  } catch {
    return []
  }
}

function writeRecents(ids: string[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(ids))
  } catch {
    /* recents are a convenience — storage denial is non-fatal */
  }
}

function isPrefab(value: unknown): value is WardrobePrefab {
  if (!value || typeof value !== 'object') return false
  const prefab = value as Partial<WardrobePrefab>
  return typeof prefab.id === 'string'
    && typeof prefab.name === 'string'
    && Array.isArray(prefab.modules)
}

function readPrefabs(): WardrobePrefab[] {
  const builtIn = [accessoriesColumnPrefab]
  if (typeof window === 'undefined') return builtIn
  try {
    const raw = window.localStorage.getItem(CUSTOM_PREFABS_KEY)
    const custom: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(custom)) return builtIn
    const byId = new Map(builtIn.map(prefab => [prefab.id, prefab]))
    for (const prefab of custom) {
      if (isPrefab(prefab)) byId.set(prefab.id, prefab)
    }
    return [...byId.values()]
  } catch {
    return builtIn
  }
}

function premiumIdsForPrefab(prefab: WardrobePrefab): string[] {
  return [...new Set(prefab.modules
    .map(module => module.assetId)
    .filter(assetId => wardrobeAssetRegistry[assetId]?.premium === true))]
}

function AssetThumb({ def }: { def: WardrobeAssetDefinition }) {
  const [stage, setStage] = useState<'thumb' | 'source' | 'fallback'>(
    def.thumbnailSource ? 'thumb' : hasWardrobeAssetArt(def) ? 'source' : 'fallback',
  )
  if (stage === 'fallback') {
    return (
      <div
        className={styles.thumbFallback}
        data-module-type={def.type}
        style={{ '--thumb-tone': wardrobeFallbackTone(def.assetId, def.type) } as CSSProperties}
        aria-hidden='true'
      >
        {wardrobeFallbackGlyph(def.type)}
      </div>
    )
  }
  const src = stage === 'thumb'
    ? assetSource({ ...def, source: def.thumbnailSource ?? def.source })
    : assetSource({ ...def, thumbnailSource: undefined })
  // Vite serves a missing public/ file as 200 text/html, so availability is
  // only detectable by the img's own decode failure, never by fetch status.
  return (
    <img
      className={styles.thumb}
      src={src}
      alt=''
      draggable={false}
      onError={() => setStage(stage === 'thumb' ? 'source' : 'fallback')}
    />
  )
}

export default function ModuleLibrary({ onClose }: { onClose: () => void }) {
  const state = useWardrobeEditor()
  const api = useWardrobeEditorApi()
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [recents, setRecents] = useState<string[]>(readRecents)
  const [prefabs] = useState<WardrobePrefab[]>(readPrefabs)
  const [premiumBusy, setPremiumBusy] = useState(false)
  const [premiumError, setPremiumError] = useState<string | null>(null)
  const premiumCheckInFlight = useRef(false)

  const chips = useMemo(() => ['all', 'prefabs', 'recent', ...WARDROBE_CATEGORIES], [])

  const assets = useMemo(() => {
    const all = Object.values(wardrobeAssetRegistry)
    let picked: WardrobeAssetDefinition[]
    if (category === 'prefabs') {
      picked = []
    } else if (category === 'recent') {
      picked = recents
        .map(id => all.find(a => a.assetId === id))
        .filter((a): a is WardrobeAssetDefinition => a !== undefined)
    } else if (category === 'all') {
      picked = all
    } else {
      picked = all.filter(a => a.category === category)
    }
    const q = query.trim().toLowerCase()
    if (!q) return picked
    return picked.filter(a =>
      a.name.toLowerCase().includes(q) ||
      (a.tags ?? []).some(t => t.toLowerCase().includes(q)))
  }, [category, query, recents])

  const shownPrefabs = useMemo(() => {
    if (category !== 'all' && category !== 'prefabs') return []
    const q = query.trim().toLowerCase()
    if (!q) return prefabs
    return prefabs.filter(prefab =>
      prefab.name.toLowerCase().includes(q)
      || prefab.description?.toLowerCase().includes(q)
      || prefab.category?.toLowerCase().includes(q))
  }, [category, prefabs, query])

  const requireOwnedPremium = async (assetIds: string[]): Promise<boolean> => {
    // Query on every placement instead of caching a successful check: the
    // mounted editor can outlive a sign-out/account switch, and ownership from
    // the previous user must never authorize a placement for the next one.
    const required = [...new Set(assetIds)]
    if (required.length === 0) {
      setPremiumError(null)
      return true
    }
    if (premiumCheckInFlight.current) return false
    premiumCheckInFlight.current = true
    setPremiumBusy(true)
    setPremiumError(null)
    try {
      const repository = await import('../wardrobeRepository')
      const checks = await Promise.all(required.map(assetId => repository.ownsPremiumAsset(assetId)))
      const missing = required.filter((_, index) => !checks[index])
      if (missing.length) {
        const names = missing.map(assetId => wardrobeAssetRegistry[assetId]?.name ?? assetId)
        setPremiumError(`${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} locked. Sign in with an account that owns ${names.length === 1 ? 'this item' : 'these items'} first.`)
        return false
      }
      return true
    } catch (error) {
      setPremiumError(error instanceof Error ? error.message : 'Unable to verify wardrobe ownership.')
      return false
    } finally {
      premiumCheckInFlight.current = false
      setPremiumBusy(false)
    }
  }

  const place = async (def: WardrobeAssetDefinition) => {
    if (def.premium && !(await requireOwnedPremium([def.assetId]))) return
    setPremiumError(null)
    const canvas = state.scene.canvas
    const referenceHeight =
      REFERENCE_CANVAS_WIDTH * (canvas.height / Math.max(canvas.width, 1))
    let width = def.defaultWidth / REFERENCE_CANVAS_WIDTH
    let height = def.defaultHeight / Math.max(referenceHeight, 1)
    if (width > MAX_PLACED_WIDTH) {
      height = height * (MAX_PLACED_WIDTH / width)
      width = MAX_PLACED_WIDTH
    }
    const layer = state.scene.modules.reduce((top, m) => Math.max(top, m.layer), 0) + 1
    api.addModule({
      type: def.type,
      assetId: def.assetId,
      transform: { x: 0.5, y: 0.5, width, height, rotation: 0 },
      layer,
    })
    const next = [def.assetId, ...recents.filter(id => id !== def.assetId)].slice(0, RECENTS_MAX)
    setRecents(next)
    writeRecents(next)
    playPop()
  }

  const placePrefab = async (prefab: WardrobePrefab) => {
    if (!(await requireOwnedPremium(premiumIdsForPrefab(prefab)))) return
    setPremiumError(null)
    api.applyPrefab(prefab, { x: 0.5, y: 0.5 })
    playPop()
    onClose()
  }

  return (
    <section className={styles.sheet} aria-label='Module library' aria-busy={premiumBusy}>
      <button type='button' className={styles.handle} aria-label='Close module library' onClick={onClose} />
      <header className={styles.header}>
        <h2 className={styles.title}>Modules</h2>
        <button type='button' className={styles.closeBtn} aria-label='Close' onClick={onClose}>✕</button>
      </header>
      <div className={styles.body}>
        <div className={styles.chips} role='tablist'>
          {chips.map(chip => (
            <button
              key={chip}
              type='button'
              role='tab'
              aria-selected={category === chip}
              className={category === chip ? `${styles.chip} ${styles.chipActive}` : styles.chip}
              onClick={() => { setCategory(chip); playPop() }}
            >
              {chip}
            </button>
          ))}
        </div>
        <input
          className={styles.search}
          type='search'
          placeholder='Search modules'
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        {premiumError && <p className={styles.hint} role='alert'>{premiumError}</p>}
        {assets.length === 0 && shownPrefabs.length === 0 ? (
          <p className={styles.hint}>
            {category === 'recent' && query.trim() === ''
              ? 'Nothing recent yet — tap a module to place it and it lands here.'
              : 'No modules match.'}
          </p>
        ) : (
          <>
            {shownPrefabs.length > 0 && (
              <section className={styles.prefabSection} aria-label='Wardrobe prefabs'>
                <h3 className={styles.sectionLabel}>Ready-made</h3>
                <div className={styles.grid}>
                  {shownPrefabs.map(prefab => (
                    <button
                      key={prefab.id}
                      type='button'
                      className={`${styles.card} ${styles.prefabCard}`}
                      disabled={premiumBusy}
                      onClick={() => { void placePrefab(prefab) }}
                    >
                      <span className={styles.prefabGlyph} aria-hidden='true'>▦</span>
                      <span className={styles.cardName}>{prefab.name}</span>
                      <span className={styles.prefabCount}>{prefab.modules.length} pieces</span>
                      {premiumIdsForPrefab(prefab).length > 0 && <span className={styles.proBadge}>PRO</span>}
                    </button>
                  ))}
                </div>
              </section>
            )}
            {assets.length > 0 && <div className={styles.grid}>
            {assets.map(def => (
              <button
                key={def.assetId}
                type='button'
                className={styles.card}
                disabled={premiumBusy}
                onClick={() => { void place(def) }}
              >
                <AssetThumb def={def} />
                <span className={styles.cardName}>{def.name}</span>
                {def.premium && <span className={styles.proBadge}>PRO</span>}
              </button>
            ))}
            </div>}
          </>
        )}
      </div>
    </section>
  )
}
