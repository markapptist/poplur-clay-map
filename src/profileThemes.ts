import { postNativeEvent } from './nativeBridge'

export type ProfileThemeID =
  | 'default'
  | 'chocolate'
  | 'rainbowNeon'
  | 'camouflage'
  | 'toy'
  | 'rubberPink'
  | 'icyCrystal'
  | 'luxeGold'
  | 'glamPink'

export interface ProfileTheme {
  id: ProfileThemeID
  displayName: string
  backgroundSrc: string | null
  thumbnailSrc: string | null
  primaryAccent: string
  secondaryAccent: string
  foreground: string
  overlayColor: string
  overlayOpacity: number
  statusBar: 'light' | 'dark'
  /** Extension point for server-backed premium ownership. */
  entitlement: 'included' | 'premium'
}

const asset = (name: string) => `profile-themes/${name}.png`
const thumbnail = (name: string) => `profile-themes/thumbs/${name}.jpg`

export const PROFILE_THEMES: readonly ProfileTheme[] = [
  {
    id: 'default',
    displayName: 'Poplur Default',
    backgroundSrc: null,
    thumbnailSrc: null,
    primaryAccent: '#F63B9A',
    secondaryAccent: '#5FE1EA',
    foreground: '#140A04',
    overlayColor: '#FFFFFF',
    overlayOpacity: 0,
    statusBar: 'dark',
    entitlement: 'included',
  },
  { id: 'chocolate', displayName: 'Chocolate', backgroundSrc: asset('chocolate'), thumbnailSrc: thumbnail('chocolate'), primaryAccent: '#FF3B8D', secondaryAccent: '#8B4A2B', foreground: '#FFF4EA', overlayColor: '#180A05', overlayOpacity: 0.16, statusBar: 'light', entitlement: 'included' },
  { id: 'rainbowNeon', displayName: 'Rainbow Neon', backgroundSrc: asset('rainbowNeon'), thumbnailSrc: thumbnail('rainbowNeon'), primaryAccent: '#00E7FF', secondaryAccent: '#FF3B9D', foreground: '#FFFFFF', overlayColor: '#100A34', overlayOpacity: 0.12, statusBar: 'light', entitlement: 'included' },
  { id: 'camouflage', displayName: 'Camouflage', backgroundSrc: asset('camouflage'), thumbnailSrc: thumbnail('camouflage'), primaryAccent: '#F43F8E', secondaryAccent: '#A68B5B', foreground: '#F7F0DE', overlayColor: '#0B0E09', overlayOpacity: 0.20, statusBar: 'light', entitlement: 'included' },
  { id: 'toy', displayName: 'Toy', backgroundSrc: asset('toy'), thumbnailSrc: thumbnail('toy'), primaryAccent: '#1677FF', secondaryAccent: '#FF335F', foreground: '#222222', overlayColor: '#FFFFFF', overlayOpacity: 0.05, statusBar: 'dark', entitlement: 'included' },
  { id: 'rubberPink', displayName: 'Rubber Pink', backgroundSrc: asset('rubberPink'), thumbnailSrc: thumbnail('rubberPink'), primaryAccent: '#FF2E88', secondaryAccent: '#2EE8FF', foreground: '#FFFFFF', overlayColor: '#08080B', overlayOpacity: 0.12, statusBar: 'light', entitlement: 'included' },
  { id: 'icyCrystal', displayName: 'Icy Crystal', backgroundSrc: asset('icyCrystal'), thumbnailSrc: thumbnail('icyCrystal'), primaryAccent: '#19BDF2', secondaryAccent: '#EC4FB4', foreground: '#17324D', overlayColor: '#FFFFFF', overlayOpacity: 0.08, statusBar: 'dark', entitlement: 'included' },
  { id: 'luxeGold', displayName: 'Luxe Gold', backgroundSrc: asset('luxeGold'), thumbnailSrc: thumbnail('luxeGold'), primaryAccent: '#F5C452', secondaryAccent: '#E9378F', foreground: '#FFF7D6', overlayColor: '#090705', overlayOpacity: 0.15, statusBar: 'light', entitlement: 'included' },
  { id: 'glamPink', displayName: 'Glam Pink', backgroundSrc: asset('glamPink'), thumbnailSrc: thumbnail('glamPink'), primaryAccent: '#FF2D9B', secondaryAccent: '#49DDF7', foreground: '#FFFFFF', overlayColor: '#0A0209', overlayOpacity: 0.14, statusBar: 'light', entitlement: 'included' },
] as const

export const DEFAULT_PROFILE_THEME = PROFILE_THEMES[0]
export const PROFILE_THEME_STORAGE_KEY = 'poplur.profile.theme.v1'
export const PROFILE_THEME_CHANGE_EVENT = 'poplur-profile-theme-change'

/** The house light ground — Profile's cream, now the DEFAULT ground of every
    screen (the user-facing rule: screens are white like home unless a theme
    paints them). Kept here so the default and the themed value flow through
    one custom property. */
const DEFAULT_GROUND =
  'radial-gradient(120% 60% at 50% 6%, rgba(246, 59, 154, 0.08), transparent 46%), ' +
  'linear-gradient(180deg, #f7f4ef, #efeae3)'

/**
 * The theme is APP-WIDE: one call stamps the chosen theme onto the document
 * root, and every screen that grounds itself on `var(--poplur-ground)` (and
 * inks itself with `var(--poplur-ink)`) follows — Settings, Avatar, the
 * subscreen stage, the media pages, the pull curtain, all of it. Fired at
 * boot and on every selection; the profile keeps its own local application
 * for its flip-side picker preview.
 */
export function applyProfileThemeToDocument(theme: ProfileTheme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.style.setProperty('--poplur-theme-accent', theme.primaryAccent)
  root.style.setProperty('--poplur-theme-accent-2', theme.secondaryAccent)
  // Ink follows the theme's authored foreground on a themed image; on the
  // default light ground it is the house dark ink.
  root.style.setProperty('--poplur-ink', theme.backgroundSrc ? theme.foreground : '#140A04')
  const alpha = Math.round(Math.min(1, Math.max(0, theme.overlayOpacity)) * 255)
    .toString(16).padStart(2, '0')
  root.style.setProperty(
    '--poplur-ground',
    theme.backgroundSrc
      ? `linear-gradient(${theme.overlayColor}${alpha}, ${theme.overlayColor}${alpha}), ` +
        `url("${theme.backgroundSrc}") center / cover no-repeat`
      : DEFAULT_GROUND,
  )
  root.dataset.poplurTheme = theme.id
  root.dataset.poplurThemeActive = theme.backgroundSrc ? 'true' : 'false'
}

export function profileThemeForID(value: unknown): ProfileTheme {
  return PROFILE_THEMES.find(theme => theme.id === value) ?? DEFAULT_PROFILE_THEME
}

export function readSelectedProfileTheme(): ProfileTheme {
  try {
    return profileThemeForID(window.localStorage.getItem(PROFILE_THEME_STORAGE_KEY))
  } catch {
    return DEFAULT_PROFILE_THEME
  }
}

function persist(theme: ProfileTheme): void {
  try { window.localStorage.setItem(PROFILE_THEME_STORAGE_KEY, theme.id) } catch { /* Session state still applies. */ }
  applyProfileThemeToDocument(theme)
  window.dispatchEvent(new CustomEvent<ProfileTheme>(PROFILE_THEME_CHANGE_EVENT, { detail: theme }))
}

/** Applies a user choice immediately and mirrors it into the native shell. */
export function selectProfileTheme(id: ProfileThemeID): ProfileTheme {
  const theme = profileThemeForID(id)
  persist(theme)
  postNativeEvent({ type: 'profileThemeChanged', themeID: theme.id, statusBar: theme.statusBar })
  return theme
}

/** Hydrates the web surface from native storage without creating a bridge loop. */
export function applyNativeProfileTheme(id: unknown): ProfileTheme {
  const theme = profileThemeForID(id)
  persist(theme)
  return theme
}

export function onProfileThemeChange(listener: (theme: ProfileTheme) => void): () => void {
  const receive = (event: Event) => {
    listener((event as CustomEvent<ProfileTheme>).detail ?? readSelectedProfileTheme())
  }
  const storage = (event: StorageEvent) => {
    if (event.key === PROFILE_THEME_STORAGE_KEY) listener(profileThemeForID(event.newValue))
  }
  window.addEventListener(PROFILE_THEME_CHANGE_EVENT, receive)
  window.addEventListener('storage', storage)
  return () => {
    window.removeEventListener(PROFILE_THEME_CHANGE_EVENT, receive)
    window.removeEventListener('storage', storage)
  }
}
