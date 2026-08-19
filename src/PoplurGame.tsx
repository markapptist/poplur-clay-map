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
import styles from './CreatureBattle.module.css'

interface Props { specUrl: string }

export default function PoplurGame({ specUrl }: Props) {
  const [spec, setSpec] = useState<GameSpec | null>(null)
  const [inBattle, setInBattle] = useState(false)
  /** Bumped per battle so each encounter mounts a fresh one. */
  const [round, setRound] = useState(0)

  useEffect(() => {
    let cancelled = false
    void fetch(specUrl).then(r => r.json()).then((s: GameSpec) => { if (!cancelled) setSpec(s) })
    return () => { cancelled = true }
  }, [specUrl])

  if (!spec) return <canvas className={styles.canvas} width={384} height={344} aria-label="Loading" />

  if (inBattle) {
    return (
      <CreatureBattle
        key={round}
        specUrl={specUrl}
        onFinished={() => { setInBattle(false); setRound(r => r + 1) }}
      />
    )
  }

  return (
    <Overworld
      spec={spec}
      zone={spec.zones[0]}
      onEncounter={() => setInBattle(true)}
    />
  )
}
