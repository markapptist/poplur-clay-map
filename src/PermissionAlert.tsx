import React from 'react'
import styles from './PermissionAlert.module.css'

// The app's permission alert.
//
// iOS will not let anyone restyle its own permission alert, so this is not a
// replacement for it — it is the ask that comes FIRST, in Poplur's clay, and
// only a yes here fires the real system prompt. That ordering is why it earns
// its keep: the system prompt is one-shot per install, and a reflexive "Don't
// Allow" on a bare alert costs the permission permanently. Declining this one
// costs nothing; the app can ask again next time it matters.
//
// The pre-login welcome flow shows the same alert. Post-login only the camera
// roll did, so a permission asked after sign-in looked like a different app
// from one asked before it.

export type PermissionIcon = 'photos' | 'camera' | 'location' | 'notifications' | 'motion'

export interface PermissionChoice {
  /** Button copy, in iOS's order: the declining choice sits left. */
  label: string
  /** True for the choice(s) that should trigger the real system prompt. */
  grants?: boolean
  onPick: () => void
}

export default function PermissionAlert({
  icon,
  title,
  copy,
  choices,
  label,
}: {
  icon: PermissionIcon
  title: string
  copy: string
  choices: PermissionChoice[]
  /** Accessible name for the dialog, e.g. "Camera permission". */
  label: string
}) {
  const iconClass =
    icon === 'camera' ? styles.iconCamera
      : icon === 'location' ? styles.iconLocation
        : icon === 'notifications' ? styles.iconNotifications
          : icon === 'motion' ? styles.iconMotion
            : styles.iconPhotos

  return (
    <div className={styles.scrim}>
      <div className={styles.alert} role="dialog" aria-label={label}>
        <div className={styles.content}>
          <div className={`${styles.icon} ${iconClass}`} aria-hidden="true" />
          <h2 className={`${styles.title} ${styles.shader}`}>{title}</h2>
          <p className={`${styles.copy} ${styles.shaderSoft}`}>{copy}</p>
        </div>
        <div className={`${styles.actions}${choices.length > 2 ? ` ${styles.actionsStacked}` : ''}`}>
          {choices.map(choice => (
            <button
              key={choice.label}
              className={styles.action}
              type="button"
              onClick={choice.onPick}
            >
              <span className={styles.shaderBtn}>{choice.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
