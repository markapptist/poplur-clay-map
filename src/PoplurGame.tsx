/**
 * The game: overworld until the grass produces something, then a battle, then
 * back to the overworld.
 *
 * This owns the spec and the loop between screens so neither screen has to
 * know the other exists.
 */

import React, { useEffect, useState } from 'react'
import Overworld from './Overworld'
import CreatureBattle from './CreatureBattle'
import type { GameSpec } from './battleRules'
import { useAssetPack } from './useAssetPack'
import styles from './CreatureBattle.module.css'

interface Props { specUrl: string }

export default function PoplurGame({ specUrl }: Props) {
  // The creature and tile art is an optional pack. Nothing draws until it is
  // present, so a missing download never shows as a game with invisible
  // creatures — it shows as a game that is still loading.
  const art = useAssetPack('arcade-art')
  const [spec, setSpec] = useState<GameSpec | null>(null)
  const [inBattle, setInBattle] = useState(false)
  /** Bumped per battle so each encounter mounts a fresh one. */
  const [round, setRound] = useState(0)

  useEffect(() => {
    let cancelled = false
    void fetch(specUrl).then(r => r.json()).then((s: GameSpec) => { if (!cancelled) setSpec(s) })
    return () => { cancelled = true }
  }, [specUrl])

  if (!spec || art.status !== 'ready') {
    return (
      <Notice
        text={
          art.status === 'unavailable'
            ? 'This game could not be downloaded. Check your connection and try again.'
            : art.status === 'fetching'
              ? 'Downloading game...'
              : 'Loading...'
        }
      />
    )
  }

  if (inBattle) {
    return (
      <CreatureBattle
        key={round}
        specUrl={specUrl}
        artUrl={art.url}
        onFinished={() => { setInBattle(false); setRound(r => r + 1) }}
      />
    )
  }

  return (
    <Overworld
      spec={spec}
      zone={spec.zones[0]}
      artUrl={art.url}
      onEncounter={() => setInBattle(true)}
    />
  )
}

/** What a screen shows instead of drawing against files it does not have. */
function Notice({ text }: { text: string }) {
  const ref = React.useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const g = ref.current?.getContext('2d')
    if (!g) return
    g.fillStyle = '#101828'
    g.fillRect(0, 0, 384, 344)
    g.fillStyle = '#ffffff'
    g.font = 'bold 14px ui-monospace, monospace'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    // Wrap, so a longer failure message is readable on a handheld screen.
    const words = text.split(' ')
    let line = ''
    const lines: string[] = []
    for (const word of words) {
      const next = line ? `${line} ${word}` : word
      if (g.measureText(next).width > 320) { lines.push(line); line = word } else line = next
    }
    if (line) lines.push(line)
    lines.forEach((l, i) => g.fillText(l, 192, 172 - (lines.length - 1) * 11 + i * 22))
  }, [text])
  return <canvas ref={ref} width={384} height={344} className={styles.canvas} aria-label={text} />
}
