import { useEffect, useState } from 'react'
import styles from './panels.module.css'
import type { WardrobeModule, WardrobeTransform } from '../wardrobeTypes'
import { useWardrobeEditor, useWardrobeEditorApi } from '../wardrobeStore'
import { getWardrobeAsset, wardrobeAssetRegistry } from '../wardrobeAssets'
import { clampTransform } from '../wardrobeTransforms'
import { playPop } from '../../pop'

function moduleLabel(m: WardrobeModule): string {
  const named = m.properties?.name
  if (typeof named === 'string' && named.trim() !== '') return named
  return getWardrobeAsset(m.assetId)?.name ?? m.type
}

function NumberField({ label, value, decimals, step, min, max, onCommit }: {
  label: string
  value: number
  decimals: number
  step?: number
  min?: number
  max?: number
  onCommit: (v: number) => void
}) {
  const formatted = value.toFixed(decimals)
  const [draft, setDraft] = useState(formatted)
  useEffect(() => { setDraft(formatted) }, [formatted])
  const commit = () => {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed) || parsed.toFixed(decimals) === formatted) {
      setDraft(formatted)
      return
    }
    onCommit(parsed)
  }
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <input
        className={styles.numInput}
        type='number'
        inputMode='decimal'
        step={step}
        min={min}
        max={max}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
      />
    </label>
  )
}

export default function PropertiesPanel({ onClose }: { onClose: () => void }) {
  const state = useWardrobeEditor()
  const api = useWardrobeEditorApi()
  const module = state.selectedIds.length === 1
    ? state.scene.modules.find(m => m.id === state.selectedIds[0])
    : undefined
  const asset = module ? getWardrobeAsset(module.assetId) : undefined

  const opacityValue = module?.opacity ?? 1
  const [opacityDraft, setOpacityDraft] = useState(opacityValue)
  useEffect(() => { setOpacityDraft(opacityValue) }, [opacityValue, module?.id])

  const tintValue = module?.tint ?? ''
  const [tintDraft, setTintDraft] = useState(tintValue)
  useEffect(() => { setTintDraft(tintValue) }, [tintValue, module?.id])

  const animationName = module?.animation?.name ?? ''
  const [animDraft, setAnimDraft] = useState(animationName)
  useEffect(() => { setAnimDraft(animationName) }, [animationName, module?.id])

  const commitTransform = (patch: Partial<WardrobeTransform>, label: string) => {
    if (!module) return
    const next = clampTransform({ ...module.transform, ...patch }, asset)
    api.updateTransforms({ [module.id]: next }, label)
    playPop()
  }

  const commitOpacity = () => {
    if (!module || opacityDraft === opacityValue) return
    api.setModuleProps(module.id, { opacity: opacityDraft })
    playPop()
  }

  const commitTint = () => {
    if (!module || tintDraft === tintValue) return
    api.setModuleProps(module.id, { tint: tintDraft })
    playPop()
  }

  const commitAnimationName = () => {
    if (!module) return
    const name = animDraft.trim()
    if (name === animationName) return
    api.setModuleProps(module.id, {
      animation: name === '' ? undefined : { ...module.animation, name },
    })
    playPop()
  }

  const toggleAnimationFlag = (flag: 'autoplay' | 'loop') => {
    if (!module?.animation) return
    api.setModuleProps(module.id, {
      animation: { ...module.animation, [flag]: module.animation[flag] !== true },
    })
    playPop()
  }

  const visible = module?.visible !== false
  const locked = module?.locked === true
  const attachmentParent = module?.attachment
    ? state.scene.modules.find(m => m.id === module.attachment?.parentId)
    : undefined
  const structuralParent = module?.parentId !== undefined
    ? state.scene.modules.find(m => m.id === module.parentId)
    : undefined
  const swapOptions = module
    ? Object.values(wardrobeAssetRegistry).filter(a => a.type === module.type)
    : []

  return (
    <section className={styles.sheet} aria-label='Properties'>
      <button type='button' className={styles.handle} aria-label='Close properties' onClick={onClose} />
      <header className={styles.header}>
        <h2 className={styles.title}>{module ? moduleLabel(module) : 'Properties'}</h2>
        <button type='button' className={styles.closeBtn} aria-label='Close' onClick={onClose}>✕</button>
      </header>
      <div className={styles.body}>
        {!module ? (
          <p className={styles.hint}>
            {state.selectedIds.length === 0
              ? 'Tap a module to edit its properties.'
              : 'Multiple modules selected — tap just one to edit it.'}
          </p>
        ) : (
          <div key={module.id}>
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Transform</h3>
              <div className={styles.fieldGrid}>
                <NumberField label='X' value={module.transform.x} decimals={3} step={0.01} min={0} max={1}
                  onCommit={v => commitTransform({ x: v }, 'Move')} />
                <NumberField label='Y' value={module.transform.y} decimals={3} step={0.01} min={0} max={1}
                  onCommit={v => commitTransform({ y: v }, 'Move')} />
                <NumberField label='Width' value={module.transform.width} decimals={3} step={0.01} min={0} max={1}
                  onCommit={v => commitTransform({ width: v }, 'Resize')} />
                <NumberField label='Height' value={module.transform.height} decimals={3} step={0.01} min={0} max={1}
                  onCommit={v => commitTransform({ height: v }, 'Resize')} />
                <NumberField label='Rotation °' value={module.transform.rotation} decimals={1} step={1}
                  onCommit={v => commitTransform({ rotation: v }, 'Rotate')} />
                <NumberField label='Layer' value={module.layer} decimals={0} step={1}
                  onCommit={v => {
                    const delta = Math.round(v) - module.layer
                    if (delta === 0) return
                    api.setLayer([module.id], delta)
                    playPop()
                  }} />
              </div>
            </div>

            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Appearance</h3>
              <div className={styles.inlineRow}>
                <span className={styles.fieldLabel}>Opacity</span>
                <input
                  className={styles.slider}
                  type='range'
                  min={0}
                  max={1}
                  step={0.01}
                  value={opacityDraft}
                  onChange={e => setOpacityDraft(Number(e.target.value))}
                  onPointerUp={commitOpacity}
                  onKeyUp={commitOpacity}
                  onBlur={commitOpacity}
                />
                <span className={styles.sliderValue}>{Math.round(opacityDraft * 100)}%</span>
              </div>
              {asset?.tintable && (
                <div className={styles.inlineRow}>
                  <span className={styles.fieldLabel}>Tint</span>
                  <input
                    className={styles.colorInput}
                    type='color'
                    value={/^#[0-9a-fA-F]{6}$/.test(tintDraft) ? tintDraft : '#ff2d9a'}
                    onChange={e => setTintDraft(e.target.value)}
                    onBlur={commitTint}
                  />
                  {module.tint !== undefined && (
                    <button
                      type='button'
                      className={styles.pillBtn}
                      onClick={() => { api.setModuleProps(module.id, { tint: undefined }); playPop() }}
                    >
                      Clear tint
                    </button>
                  )}
                </div>
              )}
              <div className={styles.toggleRow}>
                <button
                  type='button'
                  className={visible ? `${styles.pillBtn} ${styles.pillBtnOn}` : styles.pillBtn}
                  aria-pressed={visible}
                  onClick={() => { api.setModuleProps(module.id, { visible: !visible }); playPop() }}
                >
                  Visible
                </button>
                <button
                  type='button'
                  className={locked ? `${styles.pillBtn} ${styles.pillBtnOn}` : styles.pillBtn}
                  aria-pressed={locked}
                  onClick={() => { api.setModuleProps(module.id, { locked: !locked }); playPop() }}
                >
                  Locked
                </button>
              </div>
            </div>

            {(module.attachment || structuralParent) && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Parent</h3>
                {structuralParent && (
                  <div className={styles.inlineRow}>
                    <span className={styles.fieldLabel}>Inside</span>
                    <span className={styles.parentName}>{moduleLabel(structuralParent)}</span>
                  </div>
                )}
                {module.attachment && (
                  <div className={styles.inlineRow}>
                    <span className={styles.fieldLabel}>Attached to</span>
                    <span className={styles.parentName}>
                      {attachmentParent ? moduleLabel(attachmentParent) : module.attachment.parentId}
                      {' · '}
                      {module.attachment.pointId}
                    </span>
                    <button
                      type='button'
                      className={styles.pillBtn}
                      onClick={() => { api.detachModule(module.id); playPop() }}
                    >
                      Detach
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Asset</h3>
              <select
                className={styles.selectInput}
                value={module.assetId}
                onChange={e => { api.setModuleProps(module.id, { assetId: e.target.value }); playPop() }}
              >
                {!swapOptions.some(a => a.assetId === module.assetId) && (
                  <option value={module.assetId}>{module.assetId}</option>
                )}
                {swapOptions.map(a => (
                  <option key={a.assetId} value={a.assetId}>{a.name}</option>
                ))}
              </select>
            </div>

            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Animation</h3>
              <input
                className={styles.textInput}
                type='text'
                placeholder='Animation name'
                value={animDraft}
                onChange={e => setAnimDraft(e.target.value)}
                onBlur={commitAnimationName}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
              />
              <div className={styles.toggleRow} style={{ marginTop: 8 }}>
                <button
                  type='button'
                  className={module.animation?.autoplay ? `${styles.pillBtn} ${styles.pillBtnOn}` : styles.pillBtn}
                  aria-pressed={module.animation?.autoplay === true}
                  disabled={!module.animation}
                  onClick={() => toggleAnimationFlag('autoplay')}
                >
                  Autoplay
                </button>
                <button
                  type='button'
                  className={module.animation?.loop ? `${styles.pillBtn} ${styles.pillBtnOn}` : styles.pillBtn}
                  aria-pressed={module.animation?.loop === true}
                  disabled={!module.animation}
                  onClick={() => toggleAnimationFlag('loop')}
                >
                  Loop
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
