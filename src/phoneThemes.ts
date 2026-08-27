/** Persistent finishes for the Poplur Phone.
 *
 * The Phone can be opened from Profile or temporarily from a DM. Both routes
 * mount the same PhoneScreen, so the finish must live outside either screen's
 * React lifetime. A stable id in localStorage gives both entry points the same
 * handset without coupling the phone to Mail or the hold-menu navigator.
 */

export const PHONE_THEMES = [
  { id: 'silver', name: 'Silver', assetSet: 'poplur_bling_phone_01_silver_diamond' },
  { id: 'gold', name: 'Gold', assetSet: 'poplur_bling_phone_02_champagne_gold' },
  { id: 'rose', name: 'Rose', assetSet: 'poplur_bling_phone_03_rose_gold_pink' },
  { id: 'ruby', name: 'Ruby', assetSet: 'poplur_bling_phone_04_ruby_red' },
  { id: 'blue', name: 'Blue', assetSet: 'poplur_bling_phone_05_sapphire_blue' },
  { id: 'green', name: 'Green', assetSet: 'poplur_bling_phone_06_emerald_green' },
  { id: 'purple', name: 'Purple', assetSet: 'poplur_bling_phone_07_amethyst_purple' },
  { id: 'onyx', name: 'Onyx', assetSet: 'poplur_bling_phone_08_jet_black_onyx' },
  { id: 'aqua', name: 'Aqua', assetSet: 'poplur_bling_phone_09_icy_aqua_turquoise' },
  { id: 'holo', name: 'Holo', assetSet: 'poplur_bling_phone_10_holographic_iridescent' },
] as const

export type PhoneTheme = (typeof PHONE_THEMES)[number]
export type PhoneThemeId = PhoneTheme['id']

export const PHONE_THEME_STORAGE_KEY = 'poplur.phone.theme.v1'
export const DEFAULT_PHONE_THEME = PHONE_THEMES[0]

export interface PhoneThemeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function deviceStorage(): PhoneThemeStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function phoneThemeForId(id: string | null | undefined): PhoneTheme {
  return PHONE_THEMES.find(theme => theme.id === id) ?? DEFAULT_PHONE_THEME
}

export function readSelectedPhoneTheme(storage: PhoneThemeStorage | null = deviceStorage()): PhoneTheme {
  try {
    return phoneThemeForId(storage?.getItem(PHONE_THEME_STORAGE_KEY))
  } catch {
    return DEFAULT_PHONE_THEME
  }
}

export function saveSelectedPhoneTheme(
  id: string,
  storage: PhoneThemeStorage | null = deviceStorage(),
): PhoneTheme {
  const theme = phoneThemeForId(id)
  try {
    storage?.setItem(PHONE_THEME_STORAGE_KEY, theme.id)
  } catch {
    // The chosen finish still applies for this mounted Phone when storage is
    // unavailable (for example, a privacy-restricted embedded preview).
  }
  return theme
}

export function cyclePhoneTheme(id: string, delta: 1 | -1): PhoneTheme {
  const current = phoneThemeForId(id)
  const index = PHONE_THEMES.findIndex(theme => theme.id === current.id)
  return PHONE_THEMES[(index + delta + PHONE_THEMES.length) % PHONE_THEMES.length]
}
