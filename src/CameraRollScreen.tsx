import CameraRoll from './CameraRoll'
import styles from './ViewHarness.module.css'

/**
 * The Camera Roll as a PAGE you stand on, rather than a slot of the camera's
 * vertical pager.
 *
 * The roll has always existed as pager slots either side of the viewfinder
 * (Camera.tsx), reachable only by swiping. The hold menu's old ROLL tile
 * carried an `action`, and an action tile is handled BEFORE the page path in
 * HoldMenuTwin — it fires, closes the menu and returns, so it could only ever
 * page that pager. It could not mount a stage screen, wear its own cube, or
 * own a back ladder. Selecting, deleting and previewing all need a screen that
 * owns those, so this is a `native: true` page instead.
 *
 * The pager's roll stays a PICKER — tap a tile, compose with it — for Camera,
 * Profile and Mail. This host is where the managed roll grows. It is
 * deliberately thin for now and at behaviour parity with the pager: the roll
 * still draws its own header, because that header's count includes the device
 * library as well as this session's captures, and a host-drawn one would have
 * to duplicate that sum to avoid showing a different number to the grid
 * directly beneath it.
 */
export default function CameraRollScreen({
  onPick,
}: {
  /** Hand a chosen item to the composer, exactly as the pager's roll does. */
  onPick?: (media: { kind: 'photo' | 'video'; src: string; length?: string }) => void
}) {
  return (
    <div className={styles.cameraRollPage} data-poplur-screen="camera-roll">
      <CameraRoll active onPick={onPick} />
    </div>
  )
}
