import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import CameraRoll from './CameraRoll'
import PoplurDialog from './PoplurDialog'
import { SideControlIconImage } from './SideControlIcon'
import styles from './ViewHarness.module.css'
import { playPop } from './pop'
import { useImmersiveControls } from './useImmersiveControls'
import { stepProfilePostIndex, type ProfilePostStepDirection } from './profilePostSteps'
import {
  clearSelection,
  listCaptures,
  listSelected,
  onCameraStore,
  removeCaptures,
  selectAll,
  selectedCount,
  setPendingRollPost,
} from './cameraStore'

/**
 * The Camera Roll as a PAGE you stand on, rather than a slot of the camera's
 * vertical pager.
 *
 * The roll has always existed as pager slots either side of the viewfinder
 * (Camera.tsx), reachable only by swiping. The hold menu's old ROLL tile
 * carried an `action`, and an action tile is handled BEFORE the page path in
 * HoldMenuTwin — it fires, closes the menu and returns — so it could only page
 * that pager. It could not mount a stage screen, wear its own cube, or own a
 * back ladder. Selecting, deleting and previewing need all three.
 *
 * The pager's roll stays a PICKER — tap a tile, compose with it — for Camera,
 * Profile and Mail. Manage mode lives here, opt-in, so those three are
 * untouched.
 */
interface RollViewerItem {
  kind: 'photo' | 'video'
  src: string
  length?: string
  poster?: string
  id?: string
}

export default function CameraRollScreen({
  onPick,
  bindBack,
  onClosePage,
}: {
  /** Hand a chosen item to the composer, exactly as the pager's roll does. */
  onPick?: (media: { kind: 'photo' | 'video'; src: string; length?: string }) => void
  /** The page's back ladder, for the persistent cube. Returns true when this
   *  screen consumed the press. */
  bindBack?: (handler: (() => boolean) | null) => void
  /** Leave the roll page — used after POST hands media to the camera. */
  onClosePage?: () => void
} = {}) {
  const [manage, setManage] = useState(false)
  const [confirming, setConfirming] = useState(false)
  // The opened capture, by flat grid index — the profile's viewer shape.
  const [viewerIdx, setViewerIdx] = useState<number | null>(null)
  const [viewerItems, setViewerItems] = useState<readonly RollViewerItem[]>([])
  // Re-anchor by identity rather than closing: the shell can re-push the device
  // library under an open preview, which reorders or shrinks the list, and an
  // index alone would silently show a different picture.
  const viewerKeyRef = useRef<string | null>(null)
  const viewerGesture = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  useImmersiveControls(viewerIdx != null, 'camera-roll-photo')
  const captures = useSyncExternalStore(onCameraStore, listCaptures, listCaptures)
  const picked = useSyncExternalStore(onCameraStore, selectedCount, selectedCount)

  // Only Poplur's own captures can be selected. The device library arrives
  // one-way from the shell and there is no delete message in the bridge, so a
  // local removal would simply be undone by the next requestCameraRoll.
  const selectableIds = useMemo(() => captures.map(c => c.id), [captures])
  const allSelected = selectableIds.length > 0 && picked >= selectableIds.length

  const keyOf = (item: RollViewerItem | undefined) => item?.id ?? item?.src ?? null
  const viewerItem = viewerIdx == null ? undefined : viewerItems[viewerIdx]

  // If the list moved under the preview, follow the capture rather than the
  // slot. Closing on every re-push is the bug this avoids: the shell answers
  // requestCameraRoll whenever it likes.
  useEffect(() => {
    if (viewerIdx == null) return
    const key = viewerKeyRef.current
    if (!key) return
    if (keyOf(viewerItems[viewerIdx]) === key) return
    const moved = viewerItems.findIndex(item => keyOf(item) === key)
    if (moved >= 0) setViewerIdx(moved)
    else { setViewerIdx(null); viewerKeyRef.current = null }
  }, [viewerItems, viewerIdx])

  const openViewer = useCallback((index: number, items: readonly RollViewerItem[]) => {
    setViewerItems(items)
    setViewerIdx(index)
    viewerKeyRef.current = keyOf(items[index])
  }, [])

  const closeViewer = useCallback(() => {
    setViewerIdx(null)
    viewerKeyRef.current = null
  }, [])

  const stepViewer = useCallback((direction: ProfilePostStepDirection) => {
    setViewerIdx(current => {
      if (current == null) return current
      const next = stepProfilePostIndex(current, viewerItems.length, direction)
      if (next == null) return current
      viewerKeyRef.current = keyOf(viewerItems[next])
      playPop()
      return next
    })
  }, [viewerItems])

  const onViewerPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
    const target = event.target
    if (target instanceof Element
      && target.closest('button, a, input, textarea, select, [role="button"], [role="slider"]')) return
    viewerGesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const endViewerGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = viewerGesture.current
    if (!start || start.pointerId !== event.pointerId) return
    viewerGesture.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    let direction: ProfilePostStepDirection | null = null
    // Swiping the media UP pulls the next row into view, so it steps DOWN the
    // grid — the same inversion the profile viewer and the feed both use.
    if (Math.abs(dy) > 48 && Math.abs(dy) >= Math.abs(dx)) direction = dy < 0 ? 'down' : 'up'
    else if (Math.abs(dx) > 48) direction = dx < 0 ? 'right' : 'left'
    if (!direction) return
    stepViewer(direction)
  }

  const leaveManage = useCallback(() => {
    clearSelection()
    setManage(false)
  }, [])

  // Back ladder, innermost first: the prompt, then manage mode, then the page
  // itself (false lets HoldMenuTwin close it).
  const back = useCallback(() => {
    if (confirming) { setConfirming(false); return true }
    if (viewerIdx != null) { closeViewer(); return true }
    if (manage) { leaveManage(); return true }
    return false
  }, [confirming, viewerIdx, closeViewer, manage, leaveManage])
  if (bindBack) bindBack(back)

  const deleteSelected = () => {
    // From the preview it is this one capture; from manage mode, the selection.
    const doomed = viewerItem?.id ? [viewerItem.id] : listSelected()
    setConfirming(false)
    if (!doomed.length) return
    playPop()
    removeCaptures(doomed)
    if (viewerItem) closeViewer()
    // Nothing left to manage once the last capture goes.
    if (doomed.length >= selectableIds.length) setManage(false)
  }

  return (
    <div className={styles.cameraRollPage} data-poplur-screen="camera-roll">
      <header className={styles.rollHeader}>
        <img className={styles.rollLogo} src="logo_icon.png" alt="" draggable={false} />
        <h1 className={styles.rollTitle}>Camera Roll</h1>
        <span className={styles.rollCount}>
          {manage
            ? `${picked} selected`
            : `${captures.length} ${captures.length === 1 ? 'capture' : 'captures'}`}
        </span>
        <div className={styles.rollActions}>
          <button
            type="button"
            className={styles.rollAction}
            aria-pressed={manage}
            aria-label={manage ? 'Done selecting' : 'Select captures'}
            onClick={() => { playPop(); manage ? leaveManage() : setManage(true) }}
          >
            <SideControlIconImage icon="profile.select" displaySize={30} />
          </button>
          {manage && (
            <>
              <button
                type="button"
                className={styles.rollAction}
                aria-label={allSelected ? 'Deselect all' : 'Select all'}
                disabled={!selectableIds.length}
                onClick={() => { playPop(); allSelected ? clearSelection() : selectAll(selectableIds) }}
              >
                <SideControlIconImage icon="profile.select_all" displaySize={30} />
              </button>
              <button
                type="button"
                className={styles.rollAction}
                aria-label={`Delete ${picked} selected`}
                disabled={!picked}
                onClick={() => { playPop(); setConfirming(true) }}
              >
                <SideControlIconImage icon="profile.delete" displaySize={30} />
              </button>
            </>
          )}
        </div>
      </header>
      {/* Only Poplur's captures answer a tap in manage mode, so say so once in
          the header rather than leaving device tiles looking broken. */}
      {manage && (
        <p className={styles.rollManageNote} role="status">
          Your Poplur captures only — photos from your device library are managed in Photos.
        </p>
      )}
      <CameraRoll
        active
        hideHeader
        manage={manage}
        onOpenItem={manage ? undefined : openViewer}
        onPick={manage ? undefined : onPick}
      />
      {viewerItem && (
        <div
          className={styles.rollViewer}
          role="dialog"
          aria-label="Capture preview"
          onPointerDown={onViewerPointerDown}
          onPointerUp={endViewerGesture}
          onPointerCancel={endViewerGesture}
        >
          {viewerItem.kind === 'photo' ? (
            <img className={styles.rollViewerMedia} src={viewerItem.src} alt="" draggable={false} />
          ) : (
            // key on the src so stepping to another clip swaps the element
            // rather than reusing one decoder for a different video, which
            // leaves the previous frame on screen until the new one paints.
            <video
              key={viewerItem.src}
              className={styles.rollViewerMedia}
              src={viewerItem.src}
              poster={viewerItem.poster}
              controls
              playsInline
            />
          )}
          <div className={styles.rollViewerActions}>
            <button
              type="button"
              className={styles.rollViewerPost}
              onClick={() => {
                playPop()
                // The page lives in the hold menu, not in Camera, so it cannot
                // reach Camera's composer state. Park the media and leave; the
                // camera drains it on arrival.
                setPendingRollPost({ kind: viewerItem.kind, src: viewerItem.src, length: viewerItem.length })
                closeViewer()
                onClosePage?.()
              }}
            >
              Post this
            </button>
            {viewerItem.id && (
              <button
                type="button"
                className={styles.rollViewerDelete}
                aria-label="Delete this capture"
                onClick={() => { playPop(); setConfirming(true) }}
              >
                <SideControlIconImage icon="profile.delete" displaySize={30} />
              </button>
            )}
          </div>
        </div>
      )}
      {confirming && (
        <PoplurDialog
          ariaLabel="Delete captures"
          eyebrow="CAMERA ROLL"
          title={viewerItem
            ? 'Delete this capture?'
            : picked === 1 ? 'Delete this capture?' : `Delete ${picked} captures?`}
          subtitle="They are not saved anywhere else yet, so this cannot be undone."
          primaryAction={{ label: 'Delete', onActivate: deleteSelected }}
          secondaryAction={{ label: 'Keep', onActivate: () => setConfirming(false) }}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  )
}
