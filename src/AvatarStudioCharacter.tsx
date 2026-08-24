import {
  BOTTOM_COLORS, EYE_COLORS, HAIR_COLORS, SKIN_TONES, TOP_COLORS,
  type BodyShape, type FaceStyle, type HairStyle, type PoplurCharacter,
} from './characterStore'
import type { CSSProperties } from 'react'
import womanAvatar from './assets/avatars/poplur-avatar-woman-v1.png'
import manAvatar from './assets/avatars/poplur-avatar-man-v1.png'
import womanShortAvatar from './assets/avatars/poplur-avatar-woman-short-v1.png'
import womanCurlyAvatar from './assets/avatars/poplur-avatar-woman-curly-v1.png'
import manShortAvatar from './assets/avatars/poplur-avatar-man-short-v1.png'
import manLongAvatar from './assets/avatars/poplur-avatar-man-long-v1.png'
import styles from './AvatarStudioCharacter.module.css'

export type StudioCategory = 'body' | 'hair' | 'face' | 'top' | 'bottoms' | 'extras'

const hairStyles: HairStyle[] = ['short', 'long', 'curly', 'buzz']
const bodyShapes: BodyShape[] = ['slim', 'athletic', 'curvy']
const faceStyles: FaceStyle[] = ['smile', 'wink', 'freckles']

export const STUDIO_OPTIONS = { hairStyles, bodyShapes, faceStyles, SKIN_TONES, HAIR_COLORS, EYE_COLORS, TOP_COLORS, BOTTOM_COLORS }

/** A curated original avatar with real, local wardrobe treatments. The image
    is the high-detail base; its body, facial, colour, and accessory layers
    respond to the same saved selections used elsewhere in Poplur. */
export function studioInitialCharacter(saved: PoplurCharacter | null): PoplurCharacter {
  const gender = saved?.gender === 'male' ? 'male' : 'female'
  return {
    gender,
    skinTone: saved?.skinTone ?? (gender === 'male' ? '#6E4630' : '#C98B62'),
    hairColor: saved?.hairColor ?? '#2C2C2A',
    hairStyle: hairStyles.includes(saved?.hairStyle as HairStyle) ? saved!.hairStyle : 'long',
    bodyShape: bodyShapes.includes(saved?.bodyShape as BodyShape) ? saved!.bodyShape : 'slim',
    heightScale: typeof saved?.heightScale === 'number' ? saved.heightScale : 0.96,
    statureScale: typeof saved?.statureScale === 'number' ? saved.statureScale : 0.94,
    faceStyle: faceStyles.includes(saved?.faceStyle as FaceStyle) ? saved!.faceStyle : 'smile',
    eyeColor: saved?.eyeColor ?? '#4A3524',
    topColor: saved?.topColor ?? '#D4537E',
    bottomColor: saved?.bottomColor ?? '#185FA5',
    outfit: { top: saved?.outfit?.top ?? 'jacket', bottom: saved?.outfit?.bottom ?? 'jeans', shoes: saved?.outfit?.shoes ?? 'sneakers', accessory: saved?.outfit?.accessory ?? 'none' },
    updatedAt: saved?.updatedAt ?? 0,
  }
}

export default function AvatarStudioCharacter({ character, height = 420 }: { character: PoplurCharacter, height?: number }) {
  const avatar = studioInitialCharacter(character)
  const portrait = selectPortrait(avatar)
  const bodyClass = avatar.bodyShape === 'athletic' ? styles.athletic : avatar.bodyShape === 'curvy' ? styles.curvy : styles.slim
  const hairClass = avatar.hairStyle === 'short' ? styles.shortHair : avatar.hairStyle === 'curly' ? styles.curlyHair : avatar.hairStyle === 'buzz' ? styles.buzzHair : styles.longHair
  const accessory = avatar.outfit?.accessory ?? 'none'
  const portraitFilter = colourGrade(avatar)

  return (
    <div
      className={`${styles.avatar} ${avatar.gender === 'male' ? styles.male : styles.female} ${bodyClass} ${hairClass}`}
      style={{ '--studio-height': `${height}px`, '--top-tint': avatar.topColor, '--bottom-tint': avatar.bottomColor, '--hair-tint': avatar.hairColor, '--eye-tint': avatar.eyeColor, '--skin-tint': avatar.skinTone } as CSSProperties}
      role='img'
      aria-label={`${avatar.gender} Poplur avatar`}
      data-avatar-studio='polished-character-v2'
      data-avatar-gender={avatar.gender}
      data-avatar-style={`${avatar.bodyShape}-${avatar.hairStyle}-${avatar.faceStyle}-${accessory}`}
    >
      <img src={portrait} alt='' draggable={false} style={{ filter: portraitFilter }} />
      {avatar.faceStyle === 'freckles' && <span className={styles.freckles} aria-hidden='true'>· · ·</span>}
      {avatar.faceStyle === 'wink' && <span className={styles.wink} aria-hidden='true'>⌒</span>}
      {accessory === 'glasses' && <span className={styles.glasses} aria-hidden='true'>▢—▢</span>}
      {accessory === 'cap' && <span className={styles.cap} aria-hidden='true' />}
      {accessory === 'chain' && <span className={styles.chain} aria-hidden='true'>◇</span>}
    </div>
  )
}

function colourGrade(avatar: PoplurCharacter) {
  const key = `${avatar.topColor}${avatar.bottomColor}${avatar.hairColor}`
  const number = [...key].reduce((total, character) => total + character.charCodeAt(0), 0)
  const hue = number % 36 - 18
  const saturation = 1 + (number % 8) / 100
  return `hue-rotate(${hue}deg) saturate(${saturation}) contrast(1.015)`
}

function selectPortrait(avatar: PoplurCharacter) {
  if (avatar.gender === 'female') {
    if (avatar.hairStyle === 'curly') return womanCurlyAvatar
    if (avatar.hairStyle === 'short' || avatar.hairStyle === 'buzz') return womanShortAvatar
    return womanAvatar
  }
  if (avatar.hairStyle === 'long') return manLongAvatar
  if (avatar.hairStyle === 'short' || avatar.hairStyle === 'buzz') return manShortAvatar
  return manAvatar
}
