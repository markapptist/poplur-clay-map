import React, { useEffect, useRef, useState } from 'react'
import styles from './AppsScreen.module.css'
import { playPop } from './pop'
import {
  listMiniApps,
  type MiniAppComponent,
  type MiniAppDefinition,
} from './miniApps'
import {
  dropAt,
  formatCoords,
  onPostedContentChange,
  pickUp,
  postingFor,
  radiusKmFor,
} from './postedContent'
import { HOME } from './reach'

// APPS — the folder of mini-apps this account has made. The grid is the
// catalogue; opening one hands its DEFINITION to MiniAppRunner, which
// interprets it against the component/action whitelist in miniApps.ts.
// The runner is the only place a definition's words become behaviour.
//
// Every tile carries the two facts that make an app a POST rather than a file:
// the radius it reaches, and the ground it was left on. An app that has never
// been dropped says so — it has no reach, which is different from a reach of
// zero. Dropping is a move, never a copy: postedContent enforces the
// one-location rule, so the button is "MOVE HERE" once something is down, not
// a second drop.

const RAINBOW = ['#ff2d55', '#ff9500', '#ffd60a', '#34c759', '#00c7be', '#007aff', '#5856d6', '#ff2d92']

function MiniAppRunner({ app, onExit }: { app: MiniAppDefinition; onExit: () => void }) {
  const [variables, setVariables] = useState(app.variables)
  const [rainbowIndex, setRainbowIndex] = useState(0)
  const screen = app.screens[0]

  const on = variables.on === true
  const speed = typeof variables.speed === 'number' ? variables.speed : 2

  // The rainbow clock. Interval-driven colour steps rather than a CSS
  // animation so the slider's speed takes effect immediately, and so the
  // light STOPS costing anything the moment it is off or the app closes.
  useEffect(() => {
    if (!on) return
    const timer = window.setInterval(
      () => setRainbowIndex(i => (i + 1) % RAINBOW.length),
      Math.max(60, 1000 / speed),
    )
    return () => window.clearInterval(timer)
  }, [on, speed])

  const runAction = (component: MiniAppComponent) => {
    const action = component.action?.type
    if (!action) return
    playPop()
    if (action === 'screenlight.toggle' || action === 'variable.toggle') {
      setVariables(v => ({ ...v, on: v.on !== true }))
    } else if (action === 'navigation.back') {
      onExit()
    }
  }

  return (
    <div className={styles.runner} data-lit={on ? 'true' : 'false'}>
      {screen.components.map((component, i) => {
        if (component.type === 'screenlight') {
          return (
            <div
              key={i}
              className={styles.screenlight}
              style={{ background: on ? RAINBOW[rainbowIndex] : '#08040c' }}
              aria-hidden="true"
            />
          )
        }
        if (component.type === 'heading') {
          return <h1 key={i} className={styles.runnerHeading}>{component.text}</h1>
        }
        if (component.type === 'text') {
          return <p key={i} className={styles.runnerText}>{component.text}</p>
        }
        if (component.type === 'button') {
          return (
            <button key={i} type="button" className={styles.runnerButton} onClick={() => runAction(component)}>
              {component.text}
            </button>
          )
        }
        if (component.type === 'slider' && component.binding) {
          const value = typeof variables[component.binding] === 'number'
            ? variables[component.binding] as number
            : component.min ?? 0
          return (
            <label key={i} className={styles.runnerSlider}>
              <span>SPEED</span>
              <input
                type="range"
                min={component.min ?? 0}
                max={component.max ?? 10}
                step={component.step ?? 1}
                value={value}
                onChange={e => {
                  const next = Number(e.target.value)
                  setVariables(v => ({ ...v, [component.binding as string]: next }))
                }}
              />
            </label>
          )
        }
        return null
      })}
    </div>
  )
}

export default function AppsScreen({ bindBack }: {
  /** The cube steps back from an open app to the folder before closing. */
  bindBack?: (fn: (() => boolean) | null) => void
} = {}) {
  const [apps] = useState(listMiniApps)
  const [openApp, setOpenApp] = useState<MiniAppDefinition | null>(null)
  const openRef = useRef(openApp)
  openRef.current = openApp

  useEffect(() => {
    if (!bindBack) return
    bindBack(() => {
      if (openRef.current) {
        setOpenApp(null)
        return true
      }
      return false
    })
    return () => bindBack(null)
  }, [bindBack])

  if (openApp) {
    return <MiniAppRunner app={openApp} onExit={() => setOpenApp(null)} />
  }

  return (
    <section className={styles.screen} aria-label="Your apps" data-clay-scroll>
      <div className={styles.body}>
        <div className={styles.grid}>
          {apps.map(app => (
            <AppTile key={app.app.id} app={app} onOpen={() => { playPop(); setOpenApp(app) }} />
          ))}
        </div>
        <div className={styles.hint}>
          Apps you create with Poplur AI land in this folder.
        </div>
      </div>
    </section>
  )
}

/** One app in the catalogue: icon, identity, and the ground it stands on. */
function AppTile({ app, onOpen }: { app: MiniAppDefinition; onOpen: () => void }) {
  // Re-read on every drop/move/pick-up rather than holding a copy: the ledger
  // and the postings are the truth, and a like landing elsewhere in the app
  // changes this tile's radius without anything here being told directly.
  const [, bump] = useState(0)
  useEffect(() => onPostedContentChange(() => bump(n => n + 1)), [])

  const posting = postingFor('app', app.app.id)
  const reachKm = radiusKmFor('app', app.app.id)

  const toggleGround = (event: React.MouseEvent) => {
    // The tile itself opens the app; this control must not also do that.
    event.stopPropagation()
    playPop()
    if (posting) pickUp('app', app.app.id)
    // No live fix here yet, so HOME stands in — the same origin musicPosts uses
    // for a track posted without coordinates, so every distance still agrees.
    else dropAt('app', app.app.id, HOME)
    bump(n => n + 1)
  }

  return (
    <div className={styles.tile} onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onOpen() }}>
      <span className={styles.tileIcon} aria-hidden="true">
        {app.app.iconUrl
          ? <img className={styles.tileIconImg} src={app.app.iconUrl} alt="" draggable={false} />
          : app.app.icon}
      </span>
      <b>{app.app.name}</b>
      <i>{app.app.description}</i>

      <div className={styles.meta}>
        <span className={styles.radius} data-unposted={reachKm == null ? 'true' : 'false'}>
          {reachKm == null ? 'NOT POSTED' : `${reachKm.toFixed(1)} km radius`}
        </span>
        {posting && posting.place && <span className={styles.place}>{posting.place}</span>}
        {posting && <span className={styles.coords}>{formatCoords(posting.coords)}</span>}
      </div>

      <div className={styles.dropRow}>
        <button
          type="button"
          className={styles.dropButton}
          data-posted={posting ? 'true' : 'false'}
          onClick={toggleGround}
        >
          {posting ? 'PICK UP' : 'DROP HERE'}
        </button>
      </div>
    </div>
  )
}
