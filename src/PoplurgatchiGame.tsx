import React, { useEffect, useState } from 'react'
import styles from './PoplurgatchiGame.module.css'
import { playPop } from './pop'

type PetStage = 'egg' | 'baby' | 'teen' | 'adult'
type PetStat = 'hunger' | 'happiness' | 'cleanliness' | 'energy' | 'health'

interface PetState {
  stage: PetStage
  hunger: number
  happiness: number
  cleanliness: number
  energy: number
  health: number
  care: number
  actions: number
  mood: string
}

interface PetAction {
  label: string
  glyph: string
  apply: (pet: PetState) => PetState
}

const STORAGE_KEY = 'poplur.gatchi.pet.v1'

const INITIAL_PET: PetState = {
  stage: 'egg',
  hunger: 80,
  happiness: 80,
  cleanliness: 80,
  energy: 80,
  health: 100,
  care: 100,
  actions: 0,
  mood: 'Waiting to hatch',
}

const clamp = (value: number) => Math.max(0, Math.min(100, value))

function evolve(actions: number): PetStage {
  if (actions >= 15) return 'adult'
  if (actions >= 8) return 'teen'
  if (actions >= 3) return 'baby'
  return 'egg'
}

function updatePet(pet: PetState, changes: Partial<Record<PetStat, number>>, mood: string): PetState {
  const actions = pet.actions + 1
  return {
    ...pet,
    hunger: clamp(pet.hunger + (changes.hunger ?? 0)),
    happiness: clamp(pet.happiness + (changes.happiness ?? 0)),
    cleanliness: clamp(pet.cleanliness + (changes.cleanliness ?? 0)),
    energy: clamp(pet.energy + (changes.energy ?? 0)),
    health: clamp(pet.health + (changes.health ?? 0)),
    care: clamp(pet.care + 1),
    actions,
    stage: evolve(actions),
    mood,
  }
}

const ACTIONS: PetAction[] = [
  { label: 'MEAL', glyph: '🍓', apply: pet => updatePet(pet, { hunger: 18, cleanliness: -2 }, 'That hit the spot') },
  { label: 'SNACK', glyph: '🍬', apply: pet => updatePet(pet, { hunger: 5, happiness: 10, health: -2 }, 'Sugar rush') },
  { label: 'PLAY', glyph: '★', apply: pet => updatePet(pet, { happiness: 16, energy: -8, hunger: -4 }, 'Ready for another round') },
  { label: 'BATH', glyph: '◉', apply: pet => updatePet(pet, { cleanliness: 25 }, 'Sparkling clean') },
  { label: 'MED', glyph: '+', apply: pet => updatePet(pet, { health: 30 }, 'Feeling stronger') },
  { label: 'SLEEP', glyph: 'Z', apply: pet => updatePet(pet, { energy: 28, hunger: -5 }, 'Power nap complete') },
]

const STAGE_FACE: Record<PetStage, string> = {
  egg: '•',
  baby: '●',
  teen: '◆',
  adult: '★',
}

function loadPet(): PetState {
  if (typeof window === 'undefined') return INITIAL_PET
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (!saved) return INITIAL_PET
    return { ...INITIAL_PET, ...JSON.parse(saved) }
  } catch {
    return INITIAL_PET
  }
}

export function PoplurgatchiPreview({ compact = false }: { compact?: boolean }) {
  const [pet] = useState(loadPet)

  return (
    <div
      className={`${styles.preview} ${compact ? styles.previewCompact : ''}`}
      aria-hidden="true"
    >
      <div className={styles.previewShell}>
        <span className={styles.previewBrand}>Poplür</span>
        <div className={styles.previewScreen}>
          <span className={styles.previewStage}>{pet.stage}</span>
          <div className={`${styles.previewPet} ${styles[`preview${pet.stage}`]}`}>
            <span>{STAGE_FACE[pet.stage]}</span>
            <i className={styles.previewEyeLeft} />
            <i className={styles.previewEyeRight} />
            <i className={styles.previewMouth} />
          </div>
          <div className={styles.previewStats}>
            <i style={{ '--level': `${pet.hunger}%` } as React.CSSProperties} />
            <i style={{ '--level': `${pet.happiness}%` } as React.CSSProperties} />
            <i style={{ '--level': `${pet.energy}%` } as React.CSSProperties} />
          </div>
        </div>
        <div className={styles.previewControls}>
          <i />
          <i />
          <i />
        </div>
      </div>
      {!compact && <span className={styles.previewLive}>YOUR PET · LIVE PREVIEW</span>}
    </div>
  )
}

export default function PoplurgatchiGame() {
  const [pet, setPet] = useState(loadPet)
  const [selected, setSelected] = useState(0)
  const [showStats, setShowStats] = useState(false)
  const action = ACTIONS[selected]

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pet))
    } catch {
      // Persistence is optional in restricted browser previews.
    }
  }, [pet])

  const move = (direction: number) => {
    playPop()
    setShowStats(false)
    setSelected(index => (index + direction + ACTIONS.length) % ACTIONS.length)
  }

  const confirm = () => {
    playPop()
    if (showStats) {
      setShowStats(false)
      return
    }
    setPet(current => action.apply(current))
  }

  return (
    <section className={styles.game} aria-label="Poplurgatchi virtual pet game">
      <div className={styles.stars} aria-hidden="true">✦　·　★　·　✦</div>
      <div className={styles.shell}>
        <div className={styles.brand}>Poplür</div>

        <div className={styles.screen}>
          <div className={styles.screenTop}>
            <span>{pet.stage.toUpperCase()}</span>
            <button className={styles.statsButton} onClick={() => { playPop(); setShowStats(value => !value) }}>
              STATS
            </button>
          </div>

          {showStats ? (
            <div className={styles.statsPanel}>
              {([
                ['HUNGER', pet.hunger],
                ['HAPPY', pet.happiness],
                ['CLEAN', pet.cleanliness],
                ['ENERGY', pet.energy],
                ['HEALTH', pet.health],
              ] as const).map(([label, value]) => (
                <div className={styles.statRow} key={label}>
                  <span>{label}</span>
                  <div className={styles.statTrack}><i style={{ width: `${value}%` }} /></div>
                  <b>{Math.round(value)}</b>
                </div>
              ))}
              <div className={styles.care}>CARE SCORE {Math.round(pet.care)}</div>
            </div>
          ) : (
            <>
              <div className={`${styles.pet} ${styles[pet.stage]}`} aria-label={`${pet.stage} pet`}>
                <span className={styles.petMark}>{STAGE_FACE[pet.stage]}</span>
                <span className={styles.eyeLeft} />
                <span className={styles.eyeRight} />
                <span className={styles.mouth} />
              </div>
              <p className={styles.mood}>{pet.mood}</p>
              <div className={styles.actionStrip}>
                {ACTIONS.map((item, index) => (
                  <span className={index === selected ? styles.actionOn : styles.action} key={item.label}>
                    <b>{item.glyph}</b>
                    {item.label}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        <div className={styles.controls}>
          <button aria-label="Previous Poplurgatchi action" onClick={() => move(-1)}>◀</button>
          <button className={styles.confirm} aria-label={`Use ${action.label}`} onClick={confirm}>●</button>
          <button aria-label="Next Poplurgatchi action" onClick={() => move(1)}>▶</button>
        </div>
        <p className={styles.hint}>{showStats ? 'Press the middle button to return' : `${action.label} selected`}</p>
      </div>
    </section>
  )
}
