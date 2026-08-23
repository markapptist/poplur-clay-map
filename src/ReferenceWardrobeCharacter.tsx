import React, { useState } from 'react'
import type { PoplurCharacter } from './characterStore'

/** Identity and neutral colours sampled from the supplied Poplur character. */
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

/** This predicate now describes compatibility with the supplied identity,
    rather than demanding one frozen colour preset. Supported styling must
    never replace the user's character with a different renderer. */
export function isReferenceWardrobeCharacter(character: PoplurCharacter | null | undefined): boolean {
  if (!character) return true
  return character.gender === REFERENCE_APPEARANCE.gender
    && character.hairStyle === REFERENCE_APPEARANCE.hairStyle
}

/** Wardrobe is intentionally anchored to the supplied female identity. Old
    generic-avatar records keep their useful colour choices, but unsupported
    body/hair-style fields are migrated onto that identity before rendering. */
export function wardrobeInitialCharacter(saved: PoplurCharacter | null): PoplurCharacter {
  if (!saved) return referenceWardrobeCharacter()
  return {
    ...saved,
    gender: REFERENCE_APPEARANCE.gender,
    skinTone: REFERENCE_APPEARANCE.skinTone,
    hairStyle: REFERENCE_APPEARANCE.hairStyle,
  }
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
    the three genuine common-canvas layers in the supplied pack. Colour edits
    are small masks over those pixels; they never swap in ClayCharacter or any
    other generated identity. Product-panel cutouts remain closet inventory
    until matching pose-aligned wearable layers exist. */
export default function ReferenceWardrobeCharacter({
  character,
  height = 220,
  speaking = false,
}: {
  character?: PoplurCharacter | null
  height?: number
  speaking?: boolean
}) {
  const [failedLayers, setFailedLayers] = useState<string[]>([])
  const idPrefix = `${React.useId().replace(/:/g, '')}-reference`
  const baseMaskId = `${idPrefix}-base-mask`
  const baseArtifactClipId = `${idPrefix}-base-artifact-clip`
  const hairArtifactMaskId = `${idPrefix}-hair-artifact-mask`
  const whiteArtifactFilterId = `${idPrefix}-white-artifact`
  const darkPixelFilterId = `${idPrefix}-dark-pixels`
  const hairTintMaskId = `${idPrefix}-hair-tint-mask`
  const topTintMaskId = `${idPrefix}-top-tint-mask`
  const bottomTintMaskId = `${idPrefix}-bottom-tint-mask`
  const topClipId = `${idPrefix}-top-clip`
  const bottomClipId = `${idPrefix}-bottom-clip`
  const resolved = wardrobeInitialCharacter(character ?? referenceWardrobeCharacter())
  const width = height * (206 / 295)
  const hairVisible = resolved.outfit?.hairFront !== 'none'
  const glassesVisible = resolved.outfit?.glasses !== 'none'
  const baseFailed = failedLayers.includes('base')
  const fail = (layer: string) => () => setFailedLayers(current => current.includes(layer) ? current : [...current, layer])

  return (
    <svg
      width={width}
      height={height}
      viewBox='-3 0 206 295'
      role='img'
      aria-label='Your supplied Poplur character'
      data-character-renderer={baseFailed ? 'reference-missing' : 'reference-rgba'}
      data-character-base='supplied-reference-female-v1'
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        {/* The source sheet used a painted checkerboard, not true alpha. Two
            connected white remnants survived extraction. Key out only their
            near-white pixels inside the measured regions; the earlier broad
            polygon subtraction also erased the character's face and arm. */}
        <clipPath id={baseArtifactClipId}>
          <path d='M0 0 H200 V54 H0 Z M0 54 H48 V124 H0 Z M151 54 H200 V124 H151 Z M0 124 H200 V295 H0 Z' />
          <path d='M101 106 L141 104 L149 116 L139 149 L101 138 Z M58 157 L69 156 L68 184 L58 183 Z' />
        </clipPath>
        <filter id={whiteArtifactFilterId} x='-10%' y='-10%' width='120%' height='120%' colorInterpolationFilters='sRGB'>
          <feColorMatrix
            type='matrix'
            values='0      0      0      0 0
                    0      0      0      0 0
                    0      0      0      0 0
                    0.8504 2.8608 0.2888 0 -2.60'
          />
          <feComponentTransfer>
            <feFuncA type='discrete' tableValues='0 1' />
          </feComponentTransfer>
        </filter>
        <mask id={baseMaskId} x='0' y='0' width='200' height='295' maskUnits='userSpaceOnUse' maskContentUnits='userSpaceOnUse' style={{ maskType: 'luminance' }}>
          <rect x='0' y='0' width='200' height='295' fill='#fff' />
          <image
            href={REFERENCE_WARDROBE_ASSETS.base}
            x='0'
            y='0'
            width='200'
            height='295'
            preserveAspectRatio='none'
            clipPath={`url(#${baseArtifactClipId})`}
            filter={`url(#${whiteArtifactFilterId})`}
          />
        </mask>
        <mask id={hairArtifactMaskId} x='-2' y='0' width='204' height='295' maskUnits='userSpaceOnUse' maskContentUnits='userSpaceOnUse' style={{ maskType: 'luminance' }}>
          <rect x='-2' y='0' width='204' height='295' fill='#fff' />
          <image
            href={REFERENCE_WARDROBE_ASSETS.hair}
            x='-2'
            y='0'
            width='204'
            height='295'
            preserveAspectRatio='none'
            filter={`url(#${whiteArtifactFilterId})`}
          />
        </mask>

        {/* Produce an alpha-safe mask from only the darkest supplied pixels.
            This preserves skin, highlights and line work while tinting the
            authored hair/garment areas beneath the small registration clips. */}
        <filter id={darkPixelFilterId} x='-20%' y='-20%' width='140%' height='140%' colorInterpolationFilters='sRGB'>
          <feColorMatrix
            type='matrix'
            values='-0.2126 -0.7152 -0.0722 0 0.72
                    -0.2126 -0.7152 -0.0722 0 0.72
                    -0.2126 -0.7152 -0.0722 0 0.72
                     0       0       0      1 0'
          />
          <feComponentTransfer>
            <feFuncR type='discrete' tableValues='0 0 1 1' />
            <feFuncG type='discrete' tableValues='0 0 1 1' />
            <feFuncB type='discrete' tableValues='0 0 1 1' />
          </feComponentTransfer>
        </filter>

        <clipPath id={topClipId}>
          <path d='M57 129 C79 122 122 122 147 132 L144 165 C119 172 82 172 61 161 Z' />
        </clipPath>
        <clipPath id={bottomClipId}>
          <path d='M55 169 C78 164 124 164 150 170 L146 211 L105 213 L100 198 L94 213 L57 208 Z' />
        </clipPath>

        <mask id={hairTintMaskId} x='-2' y='0' width='204' height='295' maskUnits='userSpaceOnUse' style={{ maskType: 'luminance' }}>
          <image href={REFERENCE_WARDROBE_ASSETS.hair} x='-2' y='0' width='204' height='295' preserveAspectRatio='none' filter={`url(#${darkPixelFilterId})`} />
        </mask>
        <mask id={topTintMaskId} x='0' y='0' width='200' height='295' maskUnits='userSpaceOnUse' style={{ maskType: 'luminance' }}>
          <image href={REFERENCE_WARDROBE_ASSETS.base} x='0' y='0' width='200' height='295' preserveAspectRatio='none' clipPath={`url(#${topClipId})`} filter={`url(#${darkPixelFilterId})`} />
        </mask>
        <mask id={bottomTintMaskId} x='0' y='0' width='200' height='295' maskUnits='userSpaceOnUse' style={{ maskType: 'luminance' }}>
          <image href={REFERENCE_WARDROBE_ASSETS.base} x='0' y='0' width='200' height='295' preserveAspectRatio='none' clipPath={`url(#${bottomClipId})`} filter={`url(#${darkPixelFilterId})`} />
        </mask>
      </defs>

      {baseFailed ? (
        <g data-character-asset-state='missing'>
          <rect x='36' y='30' width='128' height='230' rx='34' fill='rgba(46, 9, 26, .76)' stroke='#ff62af' strokeWidth='2' />
          <text x='100' y='139' textAnchor='middle' fill='#fff' fontSize='10' fontWeight='800'>Character art</text>
          <text x='100' y='154' textAnchor='middle' fill='#ff91c6' fontSize='10' fontWeight='800'>unavailable</text>
        </g>
      ) : (
        <>
          <FullLayer href={REFERENCE_WARDROBE_ASSETS.base} x={0} y={0} width={200} height={295} mask={`url(#${baseMaskId})`} onError={fail('base')} />

          {resolved.topColor.toLowerCase() !== REFERENCE_APPEARANCE.topColor.toLowerCase() && (
            <rect x='0' y='0' width='200' height='295' fill={resolved.topColor} opacity='0.88' mask={`url(#${topTintMaskId})`} style={{ mixBlendMode: 'color' }} />
          )}
          {resolved.bottomColor.toLowerCase() !== REFERENCE_APPEARANCE.bottomColor.toLowerCase() && (
            <rect x='0' y='0' width='200' height='295' fill={resolved.bottomColor} opacity='0.88' mask={`url(#${bottomTintMaskId})`} style={{ mixBlendMode: 'color' }} />
          )}

          {/* Colour blend changes the brown irises while preserving their
              supplied black pupils, lashes and highlights. */}
          {resolved.eyeColor.toLowerCase() !== REFERENCE_APPEARANCE.eyeColor.toLowerCase() && (
            <g style={{ mixBlendMode: 'color' }} opacity='0.86' aria-hidden='true'>
              <ellipse cx='73.2' cy='84.5' rx='6.2' ry='8.2' fill={resolved.eyeColor} />
              <ellipse cx='124.7' cy='85' rx='6.2' ry='8.2' fill={resolved.eyeColor} />
            </g>
          )}

          {hairVisible && !failedLayers.includes('hair') && (
            <>
              <FullLayer href={REFERENCE_WARDROBE_ASSETS.hair} x={-2} y={0} width={204} height={295} mask={`url(#${hairArtifactMaskId})`} onError={fail('hair')} />
              {resolved.hairColor.toLowerCase() !== REFERENCE_APPEARANCE.hairColor.toLowerCase() && (
                <rect x='-2' y='0' width='204' height='295' fill={resolved.hairColor} opacity='0.78' mask={`url(#${hairTintMaskId})`} style={{ mixBlendMode: 'color' }} />
              )}
            </>
          )}

          {glassesVisible && !failedLayers.includes('glasses') && (
            <svg x='69' y='64' width='62' height='28' viewBox='24 91 166 73' preserveAspectRatio='xMidYMid meet' overflow='visible' aria-hidden='true'>
              <image href={REFERENCE_WARDROBE_ASSETS.glasses} x='0' y='0' width='206' height='295' onError={fail('glasses')} />
            </svg>
          )}
        </>
      )}

      {speaking && (
        <g aria-hidden='true'>
          <circle cx='190' cy='13' r='5' fill='#5fe1ea' stroke='#eaffff' strokeWidth='1' />
          <path d='M187.8 13 H192.2 M190 10.8 V15.2' stroke='#fff' strokeWidth='1.2' strokeLinecap='round' />
        </g>
      )}
    </svg>
  )
}
