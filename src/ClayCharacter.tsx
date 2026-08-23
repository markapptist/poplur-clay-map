import React from 'react'
import { defaultCharacter, type PoplurCharacter } from './characterStore'
import { MANIFEST, SLOT_Z, coreArtReady, partSrc, type PartSlot } from './characterParts'

function mixHex(color: string, target: string, amount: number): string {
  const sourceMatch = /^#([0-9a-f]{6})$/i.exec(color)
  const targetMatch = /^#([0-9a-f]{6})$/i.exec(target)
  if (!sourceMatch || !targetMatch) return color
  const source = Number.parseInt(sourceMatch[1], 16)
  const destination = Number.parseInt(targetMatch[1], 16)
  const channel = (shift: number) => {
    const from = (source >> shift) & 255
    const to = (destination >> shift) & 255
    return Math.round(from + (to - from) * amount).toString(16).padStart(2, '0')
  }
  return `#${channel(16)}${channel(8)}${channel(0)}`
}

/** The full-body person — the ONE drawing of a Poplur character, shared by
    the wardrobe editor and the podcast room so an outfit chosen in one is the
    outfit worn in the other. Two renderers behind one face: the layered
    paper-doll engine once the part-art library's core slots are filled
    (see characterParts.ts for the art contract), and this SVG clay body as
    the structural stand-in until then. */
export default function ClayCharacter({ character, height = 220, speaking = false }: {
  character?: PoplurCharacter | null
  height?: number
  speaking?: boolean
}) {
  const c = character ?? defaultCharacter()
  // Several characters can appear at once in the editor and preview. Unique
  // paint/filter ids stop one character's palette leaking into another.
  const paintId = React.useId().replace(/:/g, '')

  if (coreArtReady()) {
    // Layered mode: stack every slot that has a chosen (or only) part on the
    // shared 1024x1536 canvas. A slot with no art simply contributes nothing.
    const width = height * (1024 / 1536)
    const layers = (Object.keys(SLOT_Z) as PartSlot[])
      .map(slot => {
        const chosen = c.outfit?.[slot] ?? MANIFEST[slot][0]?.id
        const src = chosen ? partSrc(slot, chosen) : null
        return src ? { slot, src, z: SLOT_Z[slot] } : null
      })
      .filter((layer): layer is { slot: PartSlot, src: string, z: number } => layer !== null)
      .sort((a, b) => a.z - b.z)
    return (
      <div style={{ position: 'relative', width, height }} role="img" aria-label="Your character">
        {layers.map(layer => (
          <img
            key={layer.slot}
            src={layer.src}
            alt=""
            draggable={false}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
            // Vite answers a missing public/ file with 200 text/html, which an
            // <img> surfaces as a decode error — hide the layer, never a
            // broken-image glyph in the closet.
            onError={event => { (event.target as HTMLImageElement).style.display = 'none' }}
          />
        ))}
        {speaking && <span style={{
          position: 'absolute', top: -6, left: '50%', transform: 'translateX(-50%)',
          width: 10, height: 10, borderRadius: '50%', background: '#378ADD',
          animation: 'poplur-speak-pulse 1.4s infinite',
        }} />}
      </div>
    )
  }
  const width = height * (2 / 3)
  const female = c.gender === 'female'
  const skinLight = mixHex(c.skinTone, '#ffffff', 0.28)
  const skinShade = mixHex(c.skinTone, '#5d241d', 0.24)
  const skinDeep = mixHex(c.skinTone, '#451912', 0.38)
  const hairLight = mixHex(c.hairColor, '#ffffff', 0.2)
  const hairShade = mixHex(c.hairColor, '#08070a', 0.42)
  const topLight = mixHex(c.topColor, '#ffffff', 0.32)
  const topShade = mixHex(c.topColor, '#120c1d', 0.27)
  const bottomLight = mixHex(c.bottomColor, '#ffffff', 0.22)
  const bottomShade = mixHex(c.bottomColor, '#090714', 0.36)
  const eyeShade = mixHex(c.eyeColor, '#050407', 0.52)

  const ids = {
    skin: `${paintId}-skin`,
    hair: `${paintId}-hair`,
    top: `${paintId}-top`,
    bottom: `${paintId}-bottom`,
    clayShadow: `${paintId}-clay-shadow`,
    eyeShadow: `${paintId}-eye-shadow`,
    mouthClip: `${paintId}-mouth-clip`,
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 64 96"
      role="img"
      aria-label="Your character"
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        <radialGradient id={ids.skin} cx="34%" cy="24%" r="76%">
          <stop offset="0" stopColor={skinLight} />
          <stop offset="0.56" stopColor={c.skinTone} />
          <stop offset="1" stopColor={skinShade} />
        </radialGradient>
        <linearGradient id={ids.hair} x1="18%" y1="4%" x2="82%" y2="96%">
          <stop offset="0" stopColor={hairLight} />
          <stop offset="0.34" stopColor={c.hairColor} />
          <stop offset="1" stopColor={hairShade} />
        </linearGradient>
        <linearGradient id={ids.top} x1="12%" y1="8%" x2="88%" y2="94%">
          <stop offset="0" stopColor={topLight} />
          <stop offset="0.42" stopColor={c.topColor} />
          <stop offset="1" stopColor={topShade} />
        </linearGradient>
        <linearGradient id={ids.bottom} x1="18%" y1="0" x2="82%" y2="100%">
          <stop offset="0" stopColor={bottomLight} />
          <stop offset="0.5" stopColor={c.bottomColor} />
          <stop offset="1" stopColor={bottomShade} />
        </linearGradient>
        <filter id={ids.clayShadow} x="-35%" y="-25%" width="170%" height="175%">
          <feDropShadow dx="0" dy="1.2" stdDeviation="1.15" floodColor="#120b1a" floodOpacity="0.34" />
        </filter>
        <filter id={ids.eyeShadow} x="-40%" y="-30%" width="180%" height="180%">
          <feDropShadow dx="0" dy="0.6" stdDeviation="0.55" floodColor="#431a20" floodOpacity="0.36" />
        </filter>
        <clipPath id={ids.mouthClip}>
          <path d="M26.6 34.9 C29 37.8 35 38.2 37.5 34.7 C35.8 39.8 28.9 40.1 26.6 34.9Z" />
        </clipPath>
      </defs>

      {/* Long and curly hair sit behind the face and shoulders. */}
      {c.hairStyle === 'long' && (
        <path
          d="M18 21 C14.2 28 14.2 41.4 16.6 52.7 C18.1 57.3 22.2 57.2 23.5 52.8 L25.1 39.4 L38.9 39.4 L40.5 52.8 C41.8 57.2 45.9 57.3 47.4 52.7 C49.8 41.4 49.8 28 46 21 C42.2 11.4 22 11.4 18 21Z"
          fill={`url(#${ids.hair})`}
          stroke={hairShade}
          strokeWidth="0.75"
          filter={`url(#${ids.clayShadow})`}
        />
      )}
      {c.hairStyle === 'curly' && (
        <g fill={`url(#${ids.hair})`} stroke={hairShade} strokeWidth="0.65" filter={`url(#${ids.clayShadow})`}>
          <circle cx="18.8" cy="25.6" r="6.2" />
          <circle cx="18.9" cy="34.5" r="5.8" />
          <circle cx="22.4" cy="43" r="5.7" />
          <circle cx="45.2" cy="25.6" r="6.2" />
          <circle cx="45.1" cy="34.5" r="5.8" />
          <circle cx="41.6" cy="43" r="5.7" />
        </g>
      )}

      {/* Lower body: gently tapered legs and chunky clay sneakers. */}
      <g filter={`url(#${ids.clayShadow})`}>
        <path d="M21.2 68.3 C21.1 74.7 21.6 82.1 22.4 88.1 C23 90.5 29.1 90.4 29.7 87.8 L30.2 69Z" fill={`url(#${ids.bottom})`} stroke={bottomShade} strokeWidth="0.55" />
        <path d="M33.8 69 L34.3 87.8 C34.9 90.4 41 90.5 41.6 88.1 C42.4 82.1 42.9 74.7 42.8 68.3Z" fill={`url(#${ids.bottom})`} stroke={bottomShade} strokeWidth="0.55" />
        <path d="M21.8 86.2 C19.3 87.2 18.8 91.4 20.9 92.4 C24.7 94 30.4 93.8 31.2 91.1 C31.5 89.2 29.2 87.2 27.4 86.5Z" fill={bottomShade} />
        <path d="M42.2 86.2 C44.7 87.2 45.2 91.4 43.1 92.4 C39.3 94 33.6 93.8 32.8 91.1 C32.5 89.2 34.8 87.2 36.6 86.5Z" fill={bottomShade} />
        <path d="M21.3 89.3 C23.7 90 27 89.8 29.6 89.2" fill="none" stroke={bottomLight} strokeWidth="0.7" strokeLinecap="round" opacity="0.55" />
        <path d="M42.7 89.3 C40.3 90 37 89.8 34.4 89.2" fill="none" stroke={bottomLight} strokeWidth="0.7" strokeLinecap="round" opacity="0.55" />
      </g>

      {/* Neck, arms and soft hands. */}
      <path d="M28.2 40.6 H35.8 V49.2 H28.2Z" fill={`url(#${ids.skin})`} stroke={skinShade} strokeWidth="0.55" />
      <g filter={`url(#${ids.clayShadow})`}>
        <path d="M20.5 48 C16.6 47.5 14.1 50.3 13.6 55.2 L12.5 65.1 C12.3 68.2 17.1 68.9 18 66.1 L20.8 56.2Z" fill={`url(#${ids.top})`} stroke={topShade} strokeWidth="0.65" />
        <path d="M43.5 48 C47.4 47.5 49.9 50.3 50.4 55.2 L51.5 65.1 C51.7 68.2 46.9 68.9 46 66.1 L43.2 56.2Z" fill={`url(#${ids.top})`} stroke={topShade} strokeWidth="0.65" />
        <ellipse cx="14.9" cy="68.2" rx="3.55" ry="3.95" fill={`url(#${ids.skin})`} stroke={skinShade} strokeWidth="0.55" />
        <ellipse cx="49.1" cy="68.2" rx="3.55" ry="3.95" fill={`url(#${ids.skin})`} stroke={skinShade} strokeWidth="0.55" />
        <path d="M13.3 66.8 C14.1 66 15.6 65.8 16.7 66.3" fill="none" stroke={skinLight} strokeWidth="0.7" strokeLinecap="round" opacity="0.72" />
        <path d="M50.7 66.8 C49.9 66 48.4 65.8 47.3 66.3" fill="none" stroke={skinLight} strokeWidth="0.7" strokeLinecap="round" opacity="0.72" />
      </g>

      {/* Rounded garment with a broader masculine or softly tapered feminine silhouette. */}
      {female ? (
        <path
          d="M25 45.4 C21.2 46.5 19.4 49.2 19.6 55.2 L18.3 68.6 C18.1 72 21.2 74.2 25.2 74.4 H38.8 C42.8 74.2 45.9 72 45.7 68.6 L44.4 55.2 C44.6 49.2 42.8 46.5 39 45.4 C36.8 47.3 34.5 48.2 32 48.2 C29.5 48.2 27.2 47.3 25 45.4Z"
          fill={`url(#${ids.top})`}
          stroke={topShade}
          strokeWidth="0.72"
          filter={`url(#${ids.clayShadow})`}
        />
      ) : (
        <path
          d="M24.4 45.4 C20.4 46.2 18.4 49.4 18.6 54.5 L19.2 69.4 C19.4 72.8 22.3 74.5 26 74.5 H38 C41.7 74.5 44.6 72.8 44.8 69.4 L45.4 54.5 C45.6 49.4 43.6 46.2 39.6 45.4 C37.5 47.4 35 48.3 32 48.3 C29 48.3 26.5 47.4 24.4 45.4Z"
          fill={`url(#${ids.top})`}
          stroke={topShade}
          strokeWidth="0.72"
          filter={`url(#${ids.clayShadow})`}
        />
      )}
      <path d="M22.2 52.1 C24.8 48.6 27 48.2 29.1 48.1" fill="none" stroke={topLight} strokeWidth="1.1" strokeLinecap="round" opacity="0.48" />
      <path d="M21 69.9 C27 71.1 37 71.1 43 69.9" fill="none" stroke={topShade} strokeWidth="0.65" strokeLinecap="round" opacity="0.55" />

      {/* Ears and oversized soft clay face. */}
      <ellipse cx="16.5" cy="28.1" rx="3.25" ry="4.6" fill={`url(#${ids.skin})`} stroke={skinShade} strokeWidth="0.6" />
      <ellipse cx="47.5" cy="28.1" rx="3.25" ry="4.6" fill={`url(#${ids.skin})`} stroke={skinShade} strokeWidth="0.6" />
      <path d="M16.7 27 C18.7 25.8 19 30.3 16.8 30.6" fill="none" stroke={skinDeep} strokeWidth="0.55" strokeLinecap="round" opacity="0.48" />
      <path d="M47.3 27 C45.3 25.8 45 30.3 47.2 30.6" fill="none" stroke={skinDeep} strokeWidth="0.55" strokeLinecap="round" opacity="0.48" />
      <path
        d="M32 10 C41.8 10 47.8 17.5 47.2 28.3 C46.8 38.1 41 44.4 32 44.7 C23 44.4 17.2 38.1 16.8 28.3 C16.2 17.5 22.2 10 32 10Z"
        fill={`url(#${ids.skin})`}
        stroke={skinShade}
        strokeWidth="0.72"
        filter={`url(#${ids.clayShadow})`}
      />
      <path d="M20.3 19.4 C22.7 13.4 27.9 11.1 33.1 11.3" fill="none" stroke="#ffffff" strokeWidth="1.45" strokeLinecap="round" opacity="0.2" />
      <ellipse cx="21.7" cy="34.1" rx="3.7" ry="1.7" fill="#ef7591" opacity="0.24" />
      <ellipse cx="42.3" cy="34.1" rx="3.7" ry="1.7" fill="#ef7591" opacity="0.24" />

      {/* Hair crown and sculpted strand highlights. */}
      {c.hairStyle === 'short' && (
        <g filter={`url(#${ids.clayShadow})`}>
          <path d="M16.9 24.8 C16.4 14.3 22.7 7.8 32.5 8.2 C42.3 8.5 47.9 14.8 47 25.2 C43.4 21.5 42.2 16.4 37.3 15.5 C33.3 19.5 27.2 20.2 21 18.2 C20.4 21.6 18.9 23.8 16.9 24.8Z" fill={`url(#${ids.hair})`} stroke={hairShade} strokeWidth="0.72" />
          <path d="M23.1 11.9 C27.5 9.5 34.7 9.4 39.9 12.4" fill="none" stroke={hairLight} strokeWidth="1.15" strokeLinecap="round" opacity="0.52" />
          <path d="M28 12 C26.5 15.8 23.9 17.6 20.7 18.1" fill="none" stroke={hairShade} strokeWidth="0.75" strokeLinecap="round" opacity="0.55" />
        </g>
      )}
      {c.hairStyle === 'buzz' && (
        <g filter={`url(#${ids.clayShadow})`}>
          <path d="M18.2 20 C20.5 11.4 25.8 8.4 32 8.4 C38.2 8.4 43.5 11.4 45.8 20 C40.8 16.2 36.2 14.7 32 14.7 C27.8 14.7 23.2 16.2 18.2 20Z" fill={`url(#${ids.hair})`} stroke={hairShade} strokeWidth="0.7" />
          <path d="M23.4 13.1 C28.5 9.9 36.3 10.2 40.8 13.7" fill="none" stroke={hairLight} strokeWidth="0.9" strokeLinecap="round" opacity="0.42" />
        </g>
      )}
      {c.hairStyle === 'curly' && (
        <g fill={`url(#${ids.hair})`} stroke={hairShade} strokeWidth="0.65" filter={`url(#${ids.clayShadow})`}>
          <circle cx="20.1" cy="18.1" r="5.7" />
          <circle cx="25.1" cy="12.4" r="6.1" />
          <circle cx="32.2" cy="10.3" r="6.7" />
          <circle cx="39.5" cy="12.6" r="6" />
          <circle cx="44.5" cy="18.5" r="5.5" />
          <circle cx="17.4" cy="23.5" r="4.1" />
          <circle cx="46.6" cy="23.5" r="4.1" />
          <circle cx="24.2" cy="16" r="2" fill={hairLight} stroke="none" opacity="0.34" />
          <circle cx="36.9" cy="11.3" r="1.8" fill={hairLight} stroke="none" opacity="0.3" />
        </g>
      )}
      {c.hairStyle === 'long' && (
        <g filter={`url(#${ids.clayShadow})`}>
          <path d="M16.9 24.3 C16.7 14 22.6 7.6 32.1 7.8 C42 7.8 47.6 14.3 47.1 24.8 C43.5 20.2 40.7 16.2 36.7 14.8 C33.5 18.8 27.5 20.1 20.6 18.1 C20.4 21.2 18.9 23.3 16.9 24.3Z" fill={`url(#${ids.hair})`} stroke={hairShade} strokeWidth="0.72" />
          <path d="M23.4 11.5 C28.5 8.7 36.3 9 41 12.6" fill="none" stroke={hairLight} strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
          <path d="M20.6 18.2 C20 29.1 18.9 39 18.7 47.7" fill="none" stroke={hairLight} strokeWidth="0.8" strokeLinecap="round" opacity="0.26" />
          <path d="M43.6 18.1 C45 28.7 45.4 38.3 45.2 48" fill="none" stroke={hairShade} strokeWidth="0.8" strokeLinecap="round" opacity="0.42" />
        </g>
      )}

      {/* Brows and large polished eyes carry the reference's expression. */}
      <path d="M21.4 23.1 C24.1 21.1 27.1 21.3 29 22.8" fill="none" stroke={hairShade} strokeWidth={female ? 0.95 : 1.2} strokeLinecap="round" />
      <path d="M35 22.8 C36.9 21.3 39.9 21.1 42.6 23.1" fill="none" stroke={hairShade} strokeWidth={female ? 0.95 : 1.2} strokeLinecap="round" />
      <g filter={`url(#${ids.eyeShadow})`}>
        <ellipse cx="25.4" cy="27.8" rx="4.65" ry="5.15" fill="#442529" opacity="0.92" />
        <ellipse cx="38.6" cy="27.8" rx="4.65" ry="5.15" fill="#442529" opacity="0.92" />
        <ellipse cx="25.4" cy="27.55" rx="4.02" ry="4.5" fill="#fffaf7" />
        <ellipse cx="38.6" cy="27.55" rx="4.02" ry="4.5" fill="#fffaf7" />
        <ellipse cx="25.7" cy="28.25" rx="2.75" ry="3.3" fill={c.eyeColor} stroke={eyeShade} strokeWidth="0.55" />
        <ellipse cx="38.3" cy="28.25" rx="2.75" ry="3.3" fill={c.eyeColor} stroke={eyeShade} strokeWidth="0.55" />
        <ellipse cx="25.9" cy="28.55" rx="1.55" ry="2.1" fill="#120b11" />
        <ellipse cx="38.1" cy="28.55" rx="1.55" ry="2.1" fill="#120b11" />
        <circle cx="24.7" cy="26.7" r="1.05" fill="#ffffff" />
        <circle cx="37" cy="26.7" r="1.05" fill="#ffffff" />
        <circle cx="26.5" cy="29.6" r="0.44" fill="#ffffff" opacity="0.82" />
        <circle cx="38.8" cy="29.6" r="0.44" fill="#ffffff" opacity="0.82" />
      </g>
      {female && (
        <g stroke={hairShade} strokeWidth="0.65" strokeLinecap="round">
          <path d="M21.2 25.2 L19.7 24.5" />
          <path d="M21 26.2 L19.3 26" />
          <path d="M42.8 25.2 L44.3 24.5" />
          <path d="M43 26.2 L44.7 26" />
        </g>
      )}

      {/* Tiny nose and open smile with teeth and tongue. */}
      <path d="M31.7 29.7 C31.2 31.5 31.1 32.2 32.5 32.5" fill="none" stroke={skinDeep} strokeWidth="0.7" strokeLinecap="round" opacity="0.48" />
      <path d="M26.6 34.9 C29 37.8 35 38.2 37.5 34.7 C35.8 39.8 28.9 40.1 26.6 34.9Z" fill="#8e2f42" stroke="#6c2331" strokeWidth="0.55" strokeLinejoin="round" />
      <g clipPath={`url(#${ids.mouthClip})`}>
        <path d="M27.2 34.5 C30 35.7 34.6 35.8 37.1 34.4 L37 36.2 H27.3Z" fill="#fffaf7" />
        <ellipse cx="32.2" cy="39.1" rx="3.7" ry="1.8" fill="#ed6d82" />
      </g>

      {/* Speaking is a state marker, not a perpetual renderer loop. */}
      {speaking && (
        <g aria-hidden="true">
          <circle cx="51.2" cy="12.3" r="3.2" fill="#378ADD" stroke="#bfe2ff" strokeWidth="0.7" />
          <path d="M49.8 12.4 H52.6 M51.2 11 V13.8" stroke="#ffffff" strokeWidth="0.75" strokeLinecap="round" />
        </g>
      )}
    </svg>
  )
}
