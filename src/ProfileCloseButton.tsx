import styles from './ProfileCloseButton.module.css'

export default function ProfileCloseButton({ label, onClose, disabled = false }: {
  label: string
  onClose: () => void
  disabled?: boolean
}) {
  return <button type="button" className={styles.button} aria-label={label} onClick={onClose} disabled={disabled}>
    <img src="profile-controls/close-pink-transparent.png" alt="" aria-hidden="true" draggable={false} />
  </button>
}
