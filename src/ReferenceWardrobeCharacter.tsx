import React, { useState } from 'react'
import ClayCharacter from './ClayCharacter'
import { defaultCharacter, type PoplurCharacter } from './characterStore'

/** The supplied reference pack is one authored look. When any editable field
    diverges, the live SVG character takes over so every existing control still
    has an honest visual result instead of pretending a fixed PNG changed. */
const REFERENCE_APPEARANCE = {
  gender: 'female',
  skinTone: '#C98B62',
  hairColor: '#2C2C2A',
  hairStyle: 'long',
  eyeColor: '#4A3524',
  topColor: '#2C2C2A',
  bottomColor: '#2C2C2A',
} as const

export const REFERENCE_WARDROBE_ASSETS = {
  base: '/character/wardrobe/character-base.png',
  hair: '/character/wardrobe/hair.png',
  glasses: '/character/wardrobe/glasses.png',
  hoodie: '/character/wardrobe/hoodie.png',
  pants: '/character/wardrobe/pants.png',
  shoes: '/character/wardrobe/shoes.png',
  earrings: '/character/wardrobe/earrings.png',
  necklace: '/character/wardrobe/necklace.png',
  phone: '/character/wardrobe/phone.png',
} as const

export function referenceWardrobeCharacter(): PoplurCharacter {
  return { ...REFERENCE_APPEARANCE, updatedAt: 0 }
}

function sameColor(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

export function isReferenceWardrobeCharacter(character: PoplurCharacter | null | undefined): boolean {
  if (!character) return true
  return character.gender === REFERENCE_APPEARANCE.gender
    && character.hairStyle === REFERENCE_APPEARANCE.hairStyle
    && sameColor(character.skinTone, REFERENCE_APPEARANCE.skinTone)
    && sameColor(character.hairColor, REFERENCE_APPEARANCE.hairColor)
    && sameColor(character.eyeColor, REFERENCE_APPEARANCE.eyeColor)
    && sameColor(character.topColor, REFERENCE_APPEARANCE.topColor)
    && sameColor(character.bottomColor, REFERENCE_APPEARANCE.bottomColor)
    && Object.keys(character.outfit ?? {}).length === 0
}

/** Wardrobe-local migration for the old untouched male seed. It deliberately
    ignores updatedAt (legacy reset flows could stamp it) but requires every
    appearance field to equal the neutral global default and no selected part.
    Any genuine customization passes through unchanged. */
export function wardrobeInitialCharacter(saved: PoplurCharacter | null): PoplurCharacter {
  if (!saved) return referenceWardrobeCharacter()
  const neutral = defaultCharacter()
  const isNeutralSeed = saved.gender === neutral.gender
    && saved.hairStyle === neutral.hairStyle
    && sameColor(saved.skinTone, neutral.skinTone)
    && sameColor(saved.hairColor, neutral.hairColor)
    && sameColor(saved.eyeColor, neutral.eyeColor)
    && sameColor(saved.topColor, neutral.topColor)
    && sameColor(saved.bottomColor, neutral.bottomColor)
    && Object.keys(saved.outfit ?? {}).length === 0
  return isNeutralSeed ? referenceWardrobeCharacter() : saved
}

type LayerProps = {
  href: string
  x: number
  y: number
  width: number
  height: number
  onError: () => void
  clipPath?: string
  mask?: string
}

function FullLayer({ href, x, y, width, height, onError, clipPath, mask }: LayerProps) {
  return (
    <image
      href={href}
      x={x}
      y={y}
      width={width}
      height={height}
      preserveAspectRatio='none'
      clipPath={clipPath}
      mask={mask}
      onError={onError}
      aria-hidden='true'
    />
  )
}

/** The literal supplied Poplur fashion character. Base, hair and glasses are
    the three parts authored on the common 200×295 character canvas, so they
    can be layered without distorting the reference pose. The other supplied
    PNGs are product/closet items on shorter canvases and deliberately remain
    independent modules instead of being tangled into the avatar.

    A customized character, or one failed asset, falls through to ClayCharacter
    so wardrobe controls, scene appearance bridges and partial asset installs
    remain fully functional. */
export default function ReferenceWardrobeCharacter({
  character,
  height = 220,
  speaking = false,
}: {
  character?: PoplurCharacter | null
  height?: number
  speaking?: boolean
}) {
  const [assetFailed, setAssetFailed] = useState(false)
  const idPrefix = `${React.useId().replace(/:/g, '')}-reference`
  const baseMaskId = `${idPrefix}-base-mask`
  const resolved = character ?? referenceWardrobeCharacter()

  if (assetFailed || !isReferenceWardrobeCharacter(resolved)) {
    return <ClayCharacter character={resolved} height={height} speaking={speaking} />
  }

  const width = height * (206 / 295)
  const fail = () => setAssetFailed(true)
  return (
    <svg
      width={width}
      height={height}
      viewBox='-3 0 206 295'
      role='img'
      aria-label='Your Poplur fashion character'
      data-character-renderer='reference-rgba'
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        {/* Two white negative-space remnants were baked opaque during the
            reference extraction. Subtract their measured polygons from this
            base render only; the source PNG and nearby skin stay untouched. */}
        <mask
          id={baseMaskId}
          x='0'
          y='0'
          width='200'
          height='295'
          maskUnits='userSpaceOnUse'
          maskContentUnits='userSpaceOnUse'
          style={{ maskType: 'luminance' }}
        >
          <rect x='0' y='0' width='200' height='295' fill='#fff' />
          <path d='M101 112 L139 105 L147 116 L138 148 L104 136 Z' fill='#000' />
          <path d='M59 159 L68 157 L67 183 L59 182 Z' fill='#000' />
        </mask>
      </defs>
      <FullLayer href={REFERENCE_WARDROBE_ASSETS.base} x={0} y={0} width={200} height={295} mask={`url(#${baseMaskId})`} onError={fail} />
      <FullLayer href={REFERENCE_WARDROBE_ASSETS.hair} x={-2} y={0} width={204} height={295} onError={fail} />
      {/* Glasses share the pack's 295px panel height but are a centred product
          cutout within it. Crop the measured alpha bounds, then register that
          visible content over the supplied base character's eyes. */}
      <svg
        x='45'
        y='48'
        width='110'
        height='48'
        viewBox='24 91 166 73'
        preserveAspectRatio='none'
        overflow='hidden'
        aria-hidden='true'
      >
        <image
          href={REFERENCE_WARDROBE_ASSETS.glasses}
          x='0'
          y='0'
          width='206'
          height='295'
          onError={fail}
        />
      </svg>

      {speaking && (
        <g aria-hidden='true'>
          <circle cx='190' cy='13' r='5' fill='#378ADD' stroke='#c8e6ff' strokeWidth='1' />
          <path d='M187.8 13 H192.2 M190 10.8 V15.2' stroke='#fff' strokeWidth='1.2' strokeLinecap='round' />
        </g>
      )}
    </svg>
  )
}
