/**
 * The authoritative Cinder Isles campaign. The AI director supplies bounded
 * daily flavour, while this component owns the reviewed rules, encounters and
 * durable player progression.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Overworld from './Overworld'
import CreatureBattle from './CreatureBattle'
import {
  makeBattleOpponent,
  makeMon,
  rollEncounter,
  type BattleOpponent,
  type GameSpec,
} from './battleRules'
import {
  applyArcadeBattleOutcome,
  arcadeObjective,
  captureTotal,
  earnedBadgeNames,
  loadArcadeProgress,
  nextCampaignChallenge,
  saveArcadeProgress,
  type ArcadeBattleOutcome,
  type ArcadeProgress,
} from './arcadeProgress'
import type { GameDirectorSession } from './gameDirector'
import { useAssetPack } from './useAssetPack'
import styles from './CreatureBattle.module.css'

interface Props {
  specUrl: string
  director: GameDirectorSession
}

function isGameSpec(value: unknown): value is GameSpec {
  if (!value || typeof value !== 'object') return false
  const spec = value as Partial<GameSpec>
  return typeof spec.title === 'string'
    && typeof spec.championName === 'string'
    && typeof spec.partySize === 'number'
    && Array.isArray(spec.starters)
    && Array.isArray(spec.moves)
    && Array.isArray(spec.creatures)
    && Array.isArray(spec.zones)
    && Array.isArray(spec.arenas)
    && spec.arenas.length === 8
    && spec.arenas.every(arena => typeof arena.id === 'string'
      && typeof arena.zoneId === 'string'
      && typeof arena.badgeName === 'string'
      && Array.isArray(arena.team))
    && !!spec.champion
    && typeof spec.champion.id === 'string'
    && Array.isArray(spec.champion.team)
    && spec.zones.every(zone => !zone.trainers || Array.isArray(zone.trainers))
}

export default function PoplurGame({ specUrl, director }: Props) {
  const art = useAssetPack('arcade-art')
  const [spec, setSpec] = useState<GameSpec | null>(null)
  const [progress, setProgress] = useState<ArcadeProgress | null>(null)
  const [battle, setBattle] = useState<BattleOpponent | null>(null)
  const [round, setRound] = useState(0)
  const [activePartyIndex, setActivePartyIndex] = useState(0)
  const [fieldNotice, setFieldNotice] = useState('Find the marked grass and train your party.')
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let cancelled = false
    setSpec(null)
    setProgress(null)
    setBattle(null)
    setLoadError('')
    void (async () => {
      try {
        const response = await fetch(specUrl)
        if (!response.ok) throw new Error(`game ${response.status}`)
        const loaded: unknown = await response.json()
        if (!isGameSpec(loaded) || !loaded.creatures.length || loaded.zones.length < 9) {
          throw new Error('game specification has no playable campaign')
        }
        if (cancelled) return
        setSpec(loaded)
        setProgress(loadArcadeProgress(loaded))
      } catch (error) {
        if (!cancelled) {
          console.warn('[arcade] Cinder Isles could not load:', error)
          setLoadError('Cinder Isles could not be loaded. Check your connection and try again.')
        }
      }
    })()
    return () => { cancelled = true }
  }, [specUrl])

  useEffect(() => {
    if (spec && progress) saveArcadeProgress(progress, spec)
  }, [spec, progress])

  const party = useMemo(() => {
    if (!spec || !progress) return []
    return progress.party.filter(member =>
      spec.creatures.some(creature => creature.species === member.species))
  }, [spec, progress])

  const finishBattle = useCallback((outcome: ArcadeBattleOutcome) => {
    if (!spec || !progress) return
    const next = applyArcadeBattleOutcome(progress, outcome, spec)
    const previousLevel = progress.party[outcome.activePartyIndex]?.level
    const nextLevel = next.party[outcome.activePartyIndex]?.level
    const previousSpecies = progress.party[outcome.activePartyIndex]?.species
    const nextSpecies = next.party[outcome.activePartyIndex]?.species
    const evolved = outcome.kind === 'won' && previousSpecies && nextSpecies && previousSpecies !== nextSpecies
    const evolutionNotice = evolved
      ? (() => {
          const from = spec.creatures.find(creature => creature.species === previousSpecies)?.displayName ?? previousSpecies
          const into = spec.creatures.find(creature => creature.species === nextSpecies)?.displayName ?? nextSpecies
          return `${from} evolved into ${into}!`
        })()
      : ''

    if (next.championDefeated && !progress.championDefeated) {
      setFieldNotice(`Cinder Crown claimed! You defeated ${spec.championName} and completed the Isles.`)
    } else if (next.badges.length > progress.badges.length) {
      const badgeNames = earnedBadgeNames(next, spec)
      const badge = badgeNames[badgeNames.length - 1] ?? 'Arena Badge'
      const route = spec.zones[next.zoneIndex]?.displayName ?? 'Aurora Summit'
      setFieldNotice(`${badge} earned! ${route} unlocked. +5 Balls, +2 Tonics, +1 Revive.`)
    } else if (evolutionNotice) {
      setFieldNotice(evolutionNotice)
    } else if (outcome.kind === 'caught') {
      const caught = spec.creatures.find(creature => creature.species === outcome.wildSpecies)
      const joined = next.party.length > progress.party.length
      setFieldNotice(`${caught?.displayName ?? 'Creature'} captured${joined ? ' and joined your party' : ' and sent to storage'}!`)
    } else if (outcome.kind === 'won' && nextLevel && previousLevel && nextLevel > previousLevel) {
      const name = spec.creatures.find(creature => creature.species === next.party[outcome.activePartyIndex].species)?.displayName
      setFieldNotice(`${name ?? 'Your creature'} reached level ${nextLevel}!`)
    } else if (outcome.kind === 'won' && outcome.battleKind === 'trainer') {
      setFieldNotice(`Trainer cleared! +1 Tonic. ${arcadeObjective(next, spec)}.`)
    } else if (outcome.kind === 'won') {
      setFieldNotice(`Victory ${next.wins}! ${arcadeObjective(next, spec)}.`)
    } else if (outcome.kind === 'lost') {
      setFieldNotice('Your party recovered at camp. Train, switch creatures, and try again.')
    } else {
      setFieldNotice('The route is still open. Search the grass when you are ready.')
    }

    setProgress(next)
    setActivePartyIndex(Math.max(0, Math.min(outcome.activePartyIndex, next.party.length - 1)))
    setBattle(null)
    setRound(value => value + 1)
  }, [progress, spec])

  if (loadError) return <Notice text={loadError} />
  if (!spec || !progress || art.status !== 'ready') {
    return (
      <Notice
        text={
          art.status === 'unavailable'
            ? 'This game could not be downloaded. Check your connection and try again.'
            : art.status === 'fetching'
              ? 'Downloading Cinder Isles...'
              : 'Loading Cinder Isles...'
        }
      />
    )
  }

  const zone = spec.zones[Math.min(progress.zoneIndex, spec.zones.length - 1)]
  const challenge = nextCampaignChallenge(progress, spec)
  const difficultyDelta = director.difficulty === 'easy' ? -1 : director.difficulty === 'hard' ? 1 : 0
  if (battle) {
    return (
      <CreatureBattle
        key={round}
        spec={spec}
        opponent={battle}
        party={party}
        initialPartyIndex={activePartyIndex}
        balls={progress.balls}
        tonics={progress.tonics}
        revives={progress.revives}
        director={director}
        artUrl={art.url}
        onFinished={finishBattle}
      />
    )
  }

  return (
    <Overworld
      key={zone.id}
      spec={spec}
      zone={zone}
      artUrl={art.url}
      director={director}
      balls={progress.balls}
      tonics={progress.tonics}
      revives={progress.revives}
      wins={progress.wins}
      badges={earnedBadgeNames(progress, spec)}
      partyCount={progress.party.length}
      captures={captureTotal(progress)}
      objective={arcadeObjective(progress, spec)}
      notice={fieldNotice}
      challengeLabel={challenge
        ? `${challenge.kind === 'arena' ? 'ARENA' : challenge.kind === 'champion' ? 'CROWN' : 'BATTLE'}: ${challenge.displayName}`
        : 'HALL OF FLAME — CAMPAIGN COMPLETE'}
      onChallenge={() => {
        if (!challenge) {
          setFieldNotice(`You are the Cinder Champion. Keep exploring to complete your creature archive.`)
          return
        }
        const opponent = makeBattleOpponent(spec, {
          kind: challenge.kind,
          id: challenge.id,
          displayName: challenge.displayName,
          title: challenge.title,
          team: challenge.team.map(member => ({
            ...member,
            level: Math.max(1, Math.min(100, member.level + difficultyDelta)),
          })),
        })
        if (!opponent) {
          setFieldNotice('This campaign opponent has no valid team. Continue exploring while the route is repaired.')
          return
        }
        setBattle(opponent)
      }}
      onEncounter={() => {
        const rolled = rollEncounter(spec, zone)
        const wild = rolled
          ? makeMon(rolled.spec, Math.max(1, Math.min(100, rolled.level + difficultyDelta)))
          : null
        if (!wild) {
          setFieldNotice('Nothing lives on this route yet. Keep exploring.')
          return
        }
        setBattle({
          id: `wild:${zone.id}:${wild.spec.species}`,
          kind: 'wild',
          displayName: wild.spec.displayName,
          title: 'Wild creature',
          team: [wild],
        })
      }}
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
    const words = text.split(' ')
    let line = ''
    const lines: string[] = []
    for (const word of words) {
      const next = line ? `${line} ${word}` : word
      if (g.measureText(next).width > 320) { lines.push(line); line = word } else line = next
    }
    if (line) lines.push(line)
    lines.forEach((value, index) => g.fillText(value, 192, 172 - (lines.length - 1) * 11 + index * 22))
  }, [text])
  return <canvas ref={ref} width={384} height={344} className={styles.canvas} aria-label={text} />
}
