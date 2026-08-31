import SideControlIconButton from './SideControlIcon'

export default function MapRadioButton({
  active,
  onPress,
}: {
  active: boolean
  onPress: () => void
}) {
  return (
    <SideControlIconButton
      icon="media.radio"
      aria-label={active ? 'Turn off Poplur Radio on the map' : 'Turn on Poplur Radio on the map'}
      aria-pressed={active}
      data-map-radio-toggle=""
      activation="pointerdown"
      onActivate={onPress}
    />
  )
}
