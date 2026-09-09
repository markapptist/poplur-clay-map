import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import CameraRoll from './CameraRoll'
import PoplurDialog from './PoplurDialog'
import { SideControlIconImage } from './SideControlIcon'
import styles from './ViewHarness.module.css'
import { playPop } from './pop'
import {
  clearSelection,
  listCaptures,
  listSelected,
  onCameraStore,
  removeCaptures,
  selectAll,
  selectedCount,
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
export default function CameraRollScreen({
  onPick,
  bindBack,
}: {
  /** Hand a chosen item to the composer, exactly as the pager's roll does. */
  onPick?: (media: { kind: 'photo' | 'video'; src: string; length?: string }) => void
  /** The page's back ladder, for the persistent cube. Returns true when this
   *  screen consumed the press. */
  bindBack?: (handler: (() => boolean) | null) => void
} = {}) {
  const [manage, setManage] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const captures = useSyncExternalStore(onCameraStore, listCaptures, listCaptures)
  const picked = useSyncExternalStore(onCameraStore, selectedCount, selectedCount)

  // Only Poplur's own captures can be selected. The device library arrives
  // one-way from the shell and there is no delete message in the bridge, so a
  // local removal would simply be undone by the next requestCameraRoll.
  const selectableIds = useMemo(() => captures.map(c => c.id), [captures])
  const allSelected = selectableIds.length > 0 && picked >= selectableIds.length

  const leaveManage = useCallback(() => {
    clearSelection()
    setManage(false)
  }, [])

  // Back ladder, innermost first: the prompt, then manage mode, then the page
  // itself (false lets HoldMenuTwin close it).
  const back = useCallback(() => {
    if (confirming) { setConfirming(false); return true }
    if (manage) { leaveManage(); return true }
    return false
  }, [confirming, manage, leaveManage])
  if (bindBack) bindBack(back)

  const deleteSelected = () => {
    const doomed = listSelected()
    setConfirming(false)
    if (!doomed.length) return
    playPop()
    removeCaptures(doomed)
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
      <CameraRoll active hideHeader manage={manage} onPick={manage ? undefined : onPick} />
      {confirming && (
        <PoplurDialog
          ariaLabel="Delete captures"
          eyebrow="CAMERA ROLL"
          title={picked === 1 ? 'Delete this capture?' : `Delete ${picked} captures?`}
          subtitle="They are not saved anywhere else yet, so this cannot be undone."
          primaryAction={{ label: 'Delete', onActivate: deleteSelected }}
          secondaryAction={{ label: 'Keep', onActivate: () => setConfirming(false) }}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  )
}
