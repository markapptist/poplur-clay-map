// Which clay head the Profile tab wears. The mark head (the original) is the
// masculine one; the supplied female head joins it as an equal. Asked once in
// the pre-login flow and changeable any time in Settings → Profile — the same
// storage key on both sides, so either surface's answer is THE answer.

export type ProfileGender = 'male' | 'female'

const GENDER_KEY = 'poplur.profile.gender'
export const GENDER_CHANGE_EVENT = 'poplur-gender-change'

export const MALE_HEAD_MODEL = 'poplur_mark_head_navigator.glb'
export const FEMALE_HEAD_MODEL = 'poplur_female_head_navigator.glb'

export function readProfileGender(): ProfileGender {
  try {
    const value = window.localStorage.getItem(GENDER_KEY)
    return value === 'female' ? 'female' : 'male'
  } catch { return 'male' }
}

export function writeProfileGender(gender: ProfileGender): void {
  try { window.localStorage.setItem(GENDER_KEY, gender) } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent(GENDER_CHANGE_EVENT, { detail: { gender } }))
}

/** The head the profile tab's navigator should wear right now. */
export function profileHeadModel(): string {
  return readProfileGender() === 'female' ? FEMALE_HEAD_MODEL : MALE_HEAD_MODEL
}

export function onProfileGenderChange(listener: () => void): () => void {
  const handle = () => listener()
  window.addEventListener(GENDER_CHANGE_EVENT, handle)
  window.addEventListener('storage', handle)
  return () => {
    window.removeEventListener(GENDER_CHANGE_EVENT, handle)
    window.removeEventListener('storage', handle)
  }
}
