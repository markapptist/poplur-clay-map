import { useMemo, useRef, useState, type ReactNode } from 'react'
import styles from './panels.module.css'
import type { WardrobeModule, WardrobeScene } from '../wardrobeTypes'
import { useWardrobeEditor, useWardrobeEditorApi } from '../wardrobeStore'
import { getWardrobeAsset } from '../wardrobeAssets'
import { playPop } from '../../pop'

function moduleLabel(m: WardrobeModule): string {
  const named = m.properties?.name
  if (typeof named === 'string' && named.trim() !== '') return named
  return getWardrobeAsset(m.assetId)?.name ?? m.type
}

interface LayerNode {
  module: WardrobeModule
  /** Nested via slot attachment rather than structural parentage. */
  attached: boolean
  children: LayerNode[]
}

function buildTree(scene: WardrobeScene): LayerNode[] {
  const byId = new Map(scene.modules.map(m => [m.id, m]))
  const childrenOf = new Map<string, WardrobeModule[]>()
  const roots: WardrobeModule[] = []
  for (const m of scene.modules) {
    const parentId = m.parentId ?? m.attachment?.parentId
    if (parentId !== undefined && parentId !== m.id && byId.has(parentId)) {
      const list = childrenOf.get(parentId)
      if (list) list.push(m)
      else childrenOf.set(parentId, [m])
    } else {
      roots.push(m)
    }
  }
  const byLayerDesc = (a: WardrobeModule, b: WardrobeModule) => b.layer - a.layer
  // The store guards against parent cycles, but a corrupt scene must render
  // its modules somewhere rather than silently dropping them.
  const visited = new Set<string>()
  const toNode = (m: WardrobeModule): LayerNode => {
    visited.add(m.id)
    const children = (childrenOf.get(m.id) ?? [])
      .filter(c => !visited.has(c.id))
      .sort(byLayerDesc)
      .map(toNode)
    return { module: m, attached: m.attachment !== undefined, children }
  }
  const nodes = roots.sort(byLayerDesc).map(toNode)
  for (const m of scene.modules) {
    if (!visited.has(m.id)) {
      visited.add(m.id)
      nodes.push({ module: m, attached: m.attachment !== undefined, children: [] })
    }
  }
  return nodes
}

export default function LayersPanel({ onClose }: { onClose: () => void }) {
  const state = useWardrobeEditor()
  const api = useWardrobeEditorApi()
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [editing, setEditing] = useState<{ id: string, draft: string } | null>(null)
  const renameCancelled = useRef(false)

  const tree = useMemo(() => buildTree(state.scene), [state.scene])

  const toggleCollapsed = (id: string) => {
    const next = new Set(collapsed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setCollapsed(next)
    playPop()
  }

  const commitRename = () => {
    const edit = editing
    setEditing(null)
    if (renameCancelled.current) {
      renameCancelled.current = false
      return
    }
    if (!edit) return
    const m = state.scene.modules.find(mod => mod.id === edit.id)
    if (!m) return
    const name = edit.draft.trim()
    const current = typeof m.properties?.name === 'string' ? m.properties.name : ''
    if (name === current) return
    const properties = { ...m.properties }
    if (name === '') delete properties.name
    else properties.name = name
    api.setModuleProps(m.id, { properties })
    playPop()
  }

  const renderNode = (node: LayerNode, depth: number): ReactNode => {
    const m = node.module
    const selected = state.selectedIds.includes(m.id)
    const visible = m.visible !== false
    const locked = m.locked === true
    const isCollapsed = collapsed.has(m.id)
    return (
      <div key={m.id}>
        <div
          className={selected ? `${styles.row} ${styles.rowSelected}` : styles.row}
          style={{ paddingLeft: depth * 18 }}
          onClick={() => { api.select([m.id]); playPop() }}
          onDoubleClick={() => {
            renameCancelled.current = false
            setEditing({ id: m.id, draft: typeof m.properties?.name === 'string' ? m.properties.name : moduleLabel(m) })
          }}
        >
          {node.children.length > 0 ? (
            <button
              type='button'
              className={styles.iconBtn}
              aria-label={isCollapsed ? 'Expand' : 'Collapse'}
              onClick={e => { e.stopPropagation(); toggleCollapsed(m.id) }}
            >
              {isCollapsed ? '▸' : '▾'}
            </button>
          ) : (
            <span className={styles.disclosureSpacer} />
          )}
          {node.attached && <span className={styles.linkGlyph} aria-label='Attached'>🔗</span>}
          {editing?.id === m.id ? (
            <input
              className={styles.renameInput}
              value={editing.draft}
              autoFocus
              onClick={e => e.stopPropagation()}
              onDoubleClick={e => e.stopPropagation()}
              onChange={e => setEditing({ id: m.id, draft: e.target.value })}
              onBlur={commitRename}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') {
                  renameCancelled.current = true
                  e.currentTarget.blur()
                }
              }}
            />
          ) : (
            <span className={visible ? styles.rowName : `${styles.rowName} ${styles.rowNameHidden}`}>
              {moduleLabel(m)}
            </span>
          )}
          <button
            type='button'
            className={styles.iconBtn}
            aria-label='Raise layer'
            onClick={e => { e.stopPropagation(); api.setLayer([m.id], 1); playPop() }}
          >
            ▲
          </button>
          <button
            type='button'
            className={styles.iconBtn}
            aria-label='Lower layer'
            onClick={e => { e.stopPropagation(); api.setLayer([m.id], -1); playPop() }}
          >
            ▼
          </button>
          <button
            type='button'
            className={visible ? styles.iconBtn : `${styles.iconBtn} ${styles.iconBtnDim}`}
            aria-label={visible ? 'Hide' : 'Show'}
            aria-pressed={!visible}
            onClick={e => { e.stopPropagation(); api.setModuleProps(m.id, { visible: !visible }); playPop() }}
          >
            👁
          </button>
          <button
            type='button'
            className={locked ? styles.iconBtn : `${styles.iconBtn} ${styles.iconBtnDim}`}
            aria-label={locked ? 'Unlock' : 'Lock'}
            aria-pressed={locked}
            onClick={e => { e.stopPropagation(); api.setModuleProps(m.id, { locked: !locked }); playPop() }}
          >
            {locked ? '🔒' : '🔓'}
          </button>
        </div>
        {!isCollapsed && node.children.map(child => renderNode(child, depth + 1))}
      </div>
    )
  }

  return (
    <section className={styles.sheet} aria-label='Layers'>
      <button type='button' className={styles.handle} aria-label='Close layers' onClick={onClose} />
      <header className={styles.header}>
        <h2 className={styles.title}>Layers</h2>
        <button type='button' className={styles.closeBtn} aria-label='Close' onClick={onClose}>✕</button>
      </header>
      <div className={styles.body}>
        {tree.length === 0 ? (
          <p className={styles.hint}>The scene is empty — add modules from the library.</p>
        ) : (
          <div className={styles.tree}>
            {tree.map(node => renderNode(node, 0))}
          </div>
        )}
      </div>
    </section>
  )
}
