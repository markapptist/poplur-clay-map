export type AppIconOption = {
  id: string
  displayName: string
  previewSrc: string
}

export const APP_ICONS: readonly AppIconOption[] = [
  { id: 'default', displayName: 'Default Clay', previewSrc: '/app-icons/default.png' },
  { id: 'pastel', displayName: 'Pastel Clay', previewSrc: '/app-icons/pastel.png' },
  { id: 'neonBlue', displayName: 'Neon Blue', previewSrc: '/app-icons/neon_blue.png' },
  { id: 'roseGold', displayName: 'Rose Gold', previewSrc: '/app-icons/rose_gold.png' },
  { id: 'camo', displayName: 'Camo Clay', previewSrc: '/app-icons/camo.png' },
  { id: 'chocolate', displayName: 'Chocolate', previewSrc: '/app-icons/chocolate.png' },
  { id: 'gold', displayName: 'Gold Clay', previewSrc: '/app-icons/gold.png' },
  { id: 'ice', displayName: 'Ice Clay', previewSrc: '/app-icons/ice.png' },
  { id: 'rainbow', displayName: 'Rainbow', previewSrc: '/app-icons/rainbow.png' },
  { id: 'rubber', displayName: 'Rubber Clay', previewSrc: '/app-icons/rubber.png' },
  { id: 'sparklePink', displayName: 'Sparkle Pink', previewSrc: '/app-icons/sparkle_pink.png' },
  { id: 'toy', displayName: 'Toy Clay', previewSrc: '/app-icons/toy.png' },
]

const STORAGE_KEY = 'poplur.appIcon.v1'

export function appIconById(id: string | null | undefined): AppIconOption | undefined {
  return APP_ICONS.find(icon => icon.id === id)
}

export function readSelectedAppIcon(): AppIconOption {
  try {
    return appIconById(window.localStorage.getItem(STORAGE_KEY)) ?? APP_ICONS[0]
  } catch {
    return APP_ICONS[0]
  }
}

export function rememberSelectedAppIcon(id: string): AppIconOption {
  const icon = appIconById(id) ?? APP_ICONS[0]
  try { window.localStorage.setItem(STORAGE_KEY, icon.id) } catch { /* storage may be unavailable */ }
  return icon
}
