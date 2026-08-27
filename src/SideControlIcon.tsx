import type {
  ButtonHTMLAttributes,
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react'
import {
  runtimeSideIconSources,
  sideIconDefinition,
  sideIconUrl,
  type PoplurSideIconId,
  type PoplurSideIconSize,
} from './sideControlIcons'
import styles from './SideControlIcon.module.css'

export function SideControlIconImage({
  icon,
  displaySize = 44,
  sourceSize,
  className,
  loading = 'lazy',
  style,
}: {
  icon: PoplurSideIconId
  displaySize?: number
  /** The QA gallery may force a source. Runtime controls stay responsive. */
  sourceSize?: PoplurSideIconSize
  className?: string
  loading?: 'eager' | 'lazy'
  style?: CSSProperties
}) {
  const responsive = sourceSize == null ? runtimeSideIconSources(icon) : null
  return (
    <img
      data-poplur-side-icon={icon}
      className={className ? `${styles.image} ${className}` : styles.image}
      src={sourceSize == null ? responsive!.src : sideIconUrl(icon, sourceSize)}
      srcSet={sourceSize == null ? responsive!.srcSet : undefined}
      sizes={sourceSize == null ? `${Math.ceil(displaySize)}px` : undefined}
      width={displaySize}
      height={displaySize}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
      loading={loading}
      style={{ width: displaySize, height: displaySize, ...style }}
    />
  )
}

export interface SideControlIconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'onClick' | 'onPointerDown'
> {
  icon: PoplurSideIconId
  onActivate?: () => void
  /** Mirrors legacy controls that intentionally act at pointer-down time. */
  activation?: 'click' | 'pointerdown'
  imageSize?: number
  imageClassName?: string
  imageStyle?: CSSProperties
  loading?: boolean
  overlay?: ReactNode
  forcePressed?: boolean
}

/**
 * Shared artwork shell. The outer button remains the state/handler owner, and
 * the full-colour PNG is always decorative to assistive technology.
 */
export default function SideControlIconButton({
  icon,
  onActivate,
  activation = 'click',
  imageSize = 44,
  imageClassName,
  imageStyle,
  loading = false,
  overlay,
  forcePressed = false,
  className,
  disabled,
  type = 'button',
  'aria-label': ariaLabel,
  ...buttonProps
}: SideControlIconButtonProps) {
  const definition = sideIconDefinition(icon)
  const defaultLabel = 'accessibilityLabel' in definition
    ? definition.accessibilityLabel
    : definition.purpose
  const activate = () => {
    if (!disabled) onActivate?.()
  }
  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (activation === 'pointerdown' && event.isPrimary) activate()
  }
  const handleClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    // Keyboard-generated clicks have detail 0. Preserve keyboard activation
    // even for legacy pointer-down controls without firing twice after touch.
    if (activation === 'click' || event.detail === 0) activate()
  }

  return (
    <button
      {...buttonProps}
      type={type}
      className={className ? `${styles.button} ${className}` : styles.button}
      aria-label={ariaLabel ?? defaultLabel}
      aria-busy={loading || buttonProps['aria-busy'] || undefined}
      disabled={disabled}
      data-force-pressed={forcePressed ? 'true' : undefined}
      data-side-control-id={icon}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
    >
      <SideControlIconImage
        icon={icon}
        displaySize={imageSize}
        className={imageClassName}
        style={imageStyle}
      />
      {overlay}
      {loading && <span className={styles.loader} aria-hidden="true" />}
    </button>
  )
}
