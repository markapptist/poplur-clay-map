import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GameDirectorSession } from './gameDirector'
import { onTick } from './frameGovernor'
import styles from './PoplurgatchiPlayable.module.css'
import { playPop } from './pop'
import {
  CARE_ACTIONS,
  POPLURGATCHI_LEGACY_KEY,
  POPLURGATCHI_SAVE_KEY,
  applyElapsedDecay,
  dailyQuest,
  lifeStageForLevel,
  levelForXp,
  moodForStats,
  performCareAction,
  preparePoplurgatchiDay,
  restorePoplurgatchiState,
  xpIntoLevel,
  xpPerLevel,
  type PoplurgatchiState,
} from './poplurgatchiState'

function savedValue(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function initialState(director: GameDirectorSession): PoplurgatchiState {
  const now = Date.now()
  return restorePoplurgatchiState(
    savedValue(POPLURGATCHI_SAVE_KEY),
    savedValue(POPLURGATCHI_LEGACY_KEY),
    now,
    director.day,
  )
}

function interactiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    'button, a, input, select, textarea, summary, [contenteditable="true"], [role="button"], [role="slider"]',
  ))
}

function stat(value: number): number {
  return Math.round(value)
}

export default function PoplurgatchiPlayable({ director }: { director: GameDirectorSession }) {
  const [selected, setSelected] = useState(0)
  const [pet, setPet] = useState<PoplurgatchiState>(() => initialState(director))
  const [message, setMessage] = useState('POPLUR PET\nCare changes needs — and time does too.')
  const [burst, setBurst] = useState(0)
  const [noticeSerial, setNoticeSerial] = useState(0)
  const [dialogVisible, setDialogVisible] = useState(true)
  const [clock, setClock] = useState(() => Date.now())
  const petRef = useRef(pet)
  const skipNextPersist = useRef(false)
  petRef.current = pet

  const action = CARE_ACTIONS[selected]
  const level = levelForXp(pet.xp)
  const lifeStage = lifeStageForLevel(level)
  const mood = moodForStats(pet.stats)
  const activeDirector = pet.daily.director ?? director
  const quest = useMemo(() => dailyQuest(activeDirector, pet), [activeDirector, pet])
  const cooldownRemaining = Math.max(0, (pet.cooldowns[action.id] ?? 0) - clock)
  const questRatio = quest.target > 0 ? Math.min(1, quest.progress / quest.target) : 0

  const commit = useCallback((next: PoplurgatchiState) => {
    petRef.current = next
    setPet(next)
  }, [])

  // Persist only the validated, versioned state. Storage failures leave the
  // current session playable instead of turning a care action into an error.
  useEffect(() => {
    if (skipNextPersist.current) {
      skipNextPersist.current = false
      return
    }
    try {
      window.localStorage.setItem(POPLURGATCHI_SAVE_KEY, JSON.stringify(pet))
    } catch { /* private browsing keeps the in-memory pet */ }
  }, [pet])

  // A director can roll over while the screen is mounted. Daily activity—not
  // lifetime progression—resets at that boundary.
  useEffect(() => {
    const next = preparePoplurgatchiDay(applyElapsedDecay(petRef.current, Date.now()), director.day)
    if (next !== petRef.current) commit(next)
  }, [commit, director.day])

  // Let another Poplur tab update the same pet without creating a storage-event
  // echo. The parser validates the incoming payload before it reaches React.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== POPLURGATCHI_SAVE_KEY || !event.newValue) return
      const incoming = restorePoplurgatchiState(event.newValue, null, Date.now(), director.day)
      if (incoming.updatedAt < petRef.current.updatedAt) return
      skipNextPersist.current = true
      commit(incoming)
      setMessage('POPLUR PET\nCare synced from another screen.')
      setDialogVisible(true)
      setNoticeSerial(value => value + 1)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [commit, director.day])

  // Needs decay in a long-running session as well as when a saved pet returns.
  useEffect(() => {
    return onTick(() => {
      const next = applyElapsedDecay(petRef.current, Date.now())
      if (next !== petRef.current) commit(next)
    }, 60_000)
  }, [commit])

  // Cooldowns are timestamp-based and authoritative without this timer; the
  // short-lived clock only keeps the visible countdown honest.
  useEffect(() => {
    const endsAt = Math.max(0, ...Object.values(pet.cooldowns).filter((value): value is number => typeof value === 'number'))
    if (endsAt <= Date.now()) return undefined
    let timer: number | null = null
    const update = () => {
      const now = Date.now()
      setClock(now)
      const remaining = endsAt - now
      if (remaining > 0) timer = window.setTimeout(update, Math.min(500, remaining))
    }
    timer = window.setTimeout(update, Math.min(500, endsAt - Date.now()))
    return () => { if (timer !== null) window.clearTimeout(timer) }
  }, [pet.cooldowns])

  useEffect(() => {
    setDialogVisible(true)
    const timer = window.setTimeout(() => setDialogVisible(false), 5_000)
    return () => window.clearTimeout(timer)
  }, [noticeSerial])

  const move = useCallback((delta: number) => {
    playPop()
    const next = (selected + delta + CARE_ACTIONS.length) % CARE_ACTIONS.length
    const nextAction = CARE_ACTIONS[next]
    setSelected(next)
    setMessage(`${nextAction.name.toUpperCase()}\n${nextAction.prompt}`)
    setDialogVisible(true)
    setNoticeSerial(value => value + 1)
  }, [selected])

  const confirm = useCallback(() => {
    const now = Date.now()
    playPop()
    const result = performCareAction(petRef.current, action.id, activeDirector, now)
    if (result.state !== petRef.current) commit(result.state)
    setClock(now)
    setMessage(result.message)
    setDialogVisible(true)
    setNoticeSerial(value => value + 1)
    if (result.accepted) setBurst(value => value + 1)
  }, [action.id, activeDirector, commit])

  // Global shortcuts belong to the game surface, not focused controls. Native
  // button keyboard activation must be allowed to reach its own onClick.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || interactiveTarget(event.target)) return
      if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1) }
      else if (event.key === 'ArrowRight') { event.preventDefault(); move(1) }
      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); confirm() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirm, move])

  return (
    <div
      className={styles.game}
      role="application"
      aria-label="Playable Poplurgatchi game"
      style={{ ['--director-accent' as string]: activeDirector.accentColor }}
      data-life-stage={lifeStage}
    >
      <section className={styles.mission} aria-label={`${activeDirector.source === 'ai' ? 'AI' : 'Offline'} daily mission: ${quest.label}`}>
        <div className={styles.missionTop}>
          <span>{activeDirector.source === 'ai' ? 'AI DAILY' : 'OFFLINE DAILY'}</span>
          <b>{activeDirector.title}</b>
        </div>
        <p>{quest.label}</p>
        <div className={styles.questRow}>
          <span className={styles.questTrack} aria-hidden="true">
            <span style={{ width: `${questRatio * 100}%` }} />
          </span>
          <strong>{quest.completed ? 'DONE' : `${quest.progress}/${quest.target}`}</strong>
          <small>{quest.rewardName}</small>
        </div>
      </section>

      <div className={styles.device}>
        <img
          className={styles.deviceImage}
          src="games/poplurgatchi/assets/device-rainbow-transparent-v2.png"
          alt="Poplurgatchi virtual pet device"
          draggable={false}
        />

        <div
          className={styles.selection}
          style={{
            ['--select-x' as string]: `${33 + (selected % 4) * 11.7}%`,
            ['--select-y' as string]: `${36.7 + Math.floor(selected / 4) * 28.2}%`,
          }}
          aria-hidden="true"
        />

        <div key={burst} className={burst ? styles.burst : styles.burstIdle} aria-hidden="true">
          <span>♥</span><span>✦</span><span>♥</span>
        </div>

        <button type="button" className={`${styles.control} ${styles.previous}`} onClick={() => move(-1)} aria-label="Previous care action" />
        <button
          type="button"
          className={`${styles.control} ${styles.confirm}`}
          data-cooling={cooldownRemaining > 0 ? 'true' : 'false'}
          onClick={confirm}
          aria-label={cooldownRemaining > 0
            ? `${action.name} ready in ${Math.ceil(cooldownRemaining / 1_000)} seconds`
            : `Choose ${action.name}`}
        />
        <button type="button" className={`${styles.control} ${styles.next}`} onClick={() => move(1)} aria-label="Next care action" />
      </div>

      <aside className={styles.dashboard} aria-label="Poplurgatchi status">
        <div
          className={`${styles.dialog} ${dialogVisible ? '' : styles.dialogHidden}`}
          aria-live="polite"
          aria-hidden={!dialogVisible}
        >
          <strong>{action.name.toUpperCase()} · {mood}</strong>
          <span key={noticeSerial}>{message}</span>
        </div>

        <div className={styles.progressHud} aria-label={`Level ${level}, ${lifeStage}, ${pet.coins} coins, ${pet.streak} day streak`}>
          <span>LV {level} · {lifeStage.toUpperCase()} · {xpIntoLevel(pet.xp)}/{xpPerLevel()} XP</span>
          <span>◉ {pet.coins}</span>
          <span>◆ {pet.streak}</span>
        </div>

        <div className={styles.stats} role="group" aria-label="Poplurgatchi needs">
          <span>FOOD {stat(pet.stats.food)}</span>
          <span>HAPPY {stat(pet.stats.happiness)}</span>
          <span>ENERGY {stat(pet.stats.energy)}</span>
          <span>CLEAN {stat(pet.stats.clean)}</span>
          <span>HEALTH {stat(pet.stats.health)}</span>
        </div>
      </aside>
    </div>
  )
}
