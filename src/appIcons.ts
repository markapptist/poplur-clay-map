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
