import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  conquerPreviewFromSearch,
  MAP_CONQUER_FLIP_MS,
  MAP_CONQUER_ROW_LIMIT,
  type MapConquerSnapshot,
} from './mapConquer'
import pullStyles from './PullToRefresh.module.css'
import { usePullToRefresh } from './usePullToRefresh'
import styles from './ConquerScreen.module.css'
import { accountSnapshot, onAccountChange } from './accountStore'
import { useAuthoredPosts } from './useAuthoredPosts'
import { conqueredLandmarks } from './landmarkConquest'

const BOARD_PAGE_SIZE = 6

export default function ConquerScreen({
  snapshot,
  onClose,
}: {
  snapshot: MapConquerSnapshot | null
  onClose?: () => void
}) {
  const previewSnapshot = useMemo(
    () => typeof window === 'undefined' ? null : conquerPreviewFromSearch(window.location.search),
    [],
  )
  const simulatedPreview = previewSnapshot != null
  const sourceSnapshot = previewSnapshot ?? snapshot
  const [displaySnapshot, setDisplaySnapshot] = useState(sourceSnapshot)
  const [boardPage, setBoardPage] = useState(0)
  const [sectionPage, setSectionPage] = useState(0)
  const [accountUid, setAccountUid] = useState(() => accountSnapshot().uid)
  useEffect(() => onAccountChange(account => setAccountUid(account.uid)), [])
  const authored = useAuthoredPosts(accountUid, sectionPage === 1)
  const landmarks = useMemo(() => conqueredLandmarks(authored.snapshot?.claims ?? []), [authored.snapshot])
  const conqueredCount = landmarks.filter(landmark => landmark.covered).length
  const [flipRevision, setFlipRevision] = useState(0)
  const boardRef = useRef<HTMLElement>(null)
  const pullInnerRef = useRef<HTMLDivElement>(null)
  const pullPanelRef = useRef<HTMLDivElement>(null)
  const pullHeadRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setDisplaySnapshot(sourceSnapshot)
    setBoardPage(0)
    setFlipRevision(revision => revision + 1)
  }, [sourceSnapshot])

  useEffect(() => {
    if (!onClose) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const rows = displaySnapshot?.rows ?? []
  const pageCount = Math.max(1, Math.ceil(rows.length / BOARD_PAGE_SIZE))
  const safePage = boardPage % pageCount
  const pageStart = safePage * BOARD_PAGE_SIZE
  const visibleRows = rows.slice(pageStart, pageStart + BOARD_PAGE_SIZE)
  const totalKm = rows.reduce((sum, row) => sum + row.radiusKm, 0)
  const topFame = rows[0]?.fame ?? 0
  const maxFame = Math.max(1, topFame)

  // A departures board never sits still: every cadence advances to the next
  // ranked page and re-runs the split-flap reveal. The timer exists only while
  // this screen is mounted and parks whenever the document is hidden.
  useEffect(() => {
    if (!rows.length || sectionPage !== 0) return
    let timer = 0
    const start = () => {
      if (document.hidden || timer) return
      timer = window.setInterval(() => {
        setBoardPage(page => (page + 1) % pageCount)
        setFlipRevision(revision => revision + 1)
      }, MAP_CONQUER_FLIP_MS)
    }
    const stop = () => {
      window.clearInterval(timer)
      timer = 0
    }
    const onVisibility = () => {
      if (document.hidden) stop()
      else start()
    }
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [displaySnapshot?.generatedAt, pageCount, rows.length, sectionPage])

  const refresh = useCallback(() => {
    // Pulling re-reads the newest snapshot delivered by the map and restarts
    // at rank one. No hidden map is mounted to do this, and the same rows are
    // allowed to flip again so the gesture always has visible confirmation.
    setDisplaySnapshot(sourceSnapshot)
    setBoardPage(0)
    setFlipRevision(revision => revision + 1)
    if (sectionPage === 1) authored.retry()
  }, [sourceSnapshot, sectionPage, authored.retry])

  const showPage = (page: number) => {
    setSectionPage(page)
    if (boardRef.current) boardRef.current.scrollTop = 0
  }

  usePullToRefresh({
    scrollRef: boardRef,
    innerRef: pullInnerRef,
    panelRef: pullPanelRef,
    headRef: pullHeadRef,
    busyClass: pullStyles.busy,
    onRefresh: refresh,
  })

  return (
    <main
      id="poplur-conquer-board"
      className={styles.screen}
      data-poplur-screen="map-conquer"
      data-conquer-preview={simulatedPreview ? 'filled' : undefined}
      data-standalone={onClose ? 'true' : undefined}
    >
      <div className={styles.terrain} aria-hidden="true" />
      <section ref={boardRef} className={styles.board} aria-labelledby="poplur-conquer-title">
        <div className={pullStyles.panel} ref={pullPanelRef} data-pull-panel aria-hidden="true">
          <div className={pullStyles.head} ref={pullHeadRef}>
            <img src="sprites/poplur_mark_head_navigator_y0_p0_s640.png" alt="" draggable="false" />
          </div>
        </div>
        <div ref={pullInnerRef}>
          <header className={styles.heading}>
            <div>
              <span>
                {simulatedPreview
                  ? `SIMULATED PREVIEW · ${rows.length}/${MAP_CONQUER_ROW_LIMIT} SLOTS`
                  : `${displaySnapshot?.scope ?? 'LOCAL'} · DOMINATION LIVE`}
              </span>
              <h1 id="poplur-conquer-title">Conquer Board</h1>
            </div>
            {sectionPage === 0 && rows[0] && (
              <strong style={{ '--conquer-color': rows[0].color } as React.CSSProperties}>
                {rows[0].mine ? 'YOU' : rows[0].label}
              </strong>
            )}
          </header>

          <nav className={styles.pagination} aria-label="Conquer Board pages">
            <button type="button" className={styles.pageArrow} aria-label="Previous Conquer Board page"
              disabled={sectionPage === 0} onClick={() => showPage(0)}>‹</button>
            <button type="button" aria-current={sectionPage === 0 ? 'page' : undefined}
              onClick={() => showPage(0)}><b>1</b> Rankings</button>
            <button type="button" aria-current={sectionPage === 1 ? 'page' : undefined}
              onClick={() => showPage(1)}><b>2</b> Landmarks</button>
            <button type="button" className={styles.pageArrow} aria-label="Next Conquer Board page"
              disabled={sectionPage === 1} onClick={() => showPage(1)}>›</button>
          </nav>

          {sectionPage === 1 ? (
            <section className={styles.landmarks} aria-labelledby="conquer-landmarks-title">
              <div className={styles.landmarkHeading}>
                <div><span>YOUR LANDMARK WALL</span><h2 id="conquer-landmarks-title">Leave your mark.</h2></div>
                <strong aria-label={authored.snapshot ? `${conqueredCount} of ${landmarks.length} landmarks conquered` : accountUid ? 'Landmark count loading' : 'Sign in for your landmark count'}>
                  {authored.snapshot ? conqueredCount : '—'}<small> / {landmarks.length}</small>
                </strong>
              </div>
              <p className={styles.landmarkIntro}>Your pops cover the world, one landmark at a time.</p>
              <div className={styles.landmarkProgress} role="progressbar" aria-label="Landmarks currently conquered"
                aria-valuemin={0} aria-valuemax={landmarks.length} aria-valuenow={authored.snapshot ? conqueredCount : undefined}>
                <i style={{ width: `${conqueredCount / landmarks.length * 100}%` }} />
              </div>
              <p className={styles.landmarkStatus} role="status">
                {!accountUid ? 'Sign in to see the landmarks your pops cover.'
                  : authored.error ? 'Could not check your landmarks.'
                    : authored.loading ? 'Checking your active pops…'
                      : `${conqueredCount} currently conquered · ${landmarks.length - conqueredCount} to reach`}
                {authored.error && <button type="button" onClick={authored.retry}>Try again</button>}
              </p>
              <ul className={styles.landmarkWall}>
                {landmarks.map(landmark => (
                  <li key={landmark.id} className={`${styles.landmarkTile} ${landmark.covered ? styles.landmarkCovered : styles.landmarkLocked}`}
                    data-landmark={landmark.id} data-covered={landmark.covered}>
                    <div className={styles.landmarkArt}>
                      <img src={landmark.image} alt="" loading="lazy" decoding="async" width={320} height={320} draggable={false} />
                      <span className={styles.landmarkBadge} aria-hidden="true">{landmark.covered ? '✓' : '◇'}</span>
                    </div>
                    <strong>{landmark.name}</strong>
                    <span className={styles.landmarkPlace}>{landmark.place}</span>
                    <em>{authored.snapshot ? landmark.covered ? 'CONQUERED' : 'NOT COVERED' : 'TO DISCOVER'}</em>
                  </li>
                ))}
              </ul>
              <p className={styles.landmarkRule}>A landmark fills in while an active pop’s radius covers it. If that coverage ends, its silhouette returns.</p>
            </section>
          ) : <>

          {simulatedPreview && (
            <div className={styles.previewNotice} role="status">
              <strong>FULL BOARD SIMULATION</strong>
              <span>Preview data only — live map rankings are unchanged.</span>
            </div>
          )}

          <div className={styles.stats} aria-label="Conquer summary">
            <span><strong>{rows.length}</strong> in view</span>
            <span><strong>{Math.round(totalKm).toLocaleString()}</strong> km held</span>
            <span><strong>{topFame ? topFame.toLocaleString() : '—'}</strong> top fame</span>
          </div>

          {rows.length ? (
            <>
              <div className={styles.boardTicker}>
                <span><i aria-hidden="true" /> {simulatedPreview ? 'PREVIEW ROTATION' : 'LIVE ROTATION'}</span>
                <strong>RANKS {pageStart + 1}–{Math.min(rows.length, pageStart + BOARD_PAGE_SIZE)}</strong>
                <em>PULL TO REFRESH</em>
              </div>
              <div className={styles.list} key={`board-${safePage}-${flipRevision}`}>
                {visibleRows.map((row, index) => {
                  const globalRank = pageStart + index + 1
                  return (
                    <article
                      className={`${styles.row}${row.mine ? ` ${styles.mine}` : ''}`}
                      key={`${row.owner}-${flipRevision}`}
                      style={{
                        '--conquer-color': row.color,
                        '--flip-delay': `${index * 54}ms`,
                      } as React.CSSProperties}
                    >
                      <span className={styles.rank}>{globalRank}</span>
                      <span className={styles.avatar}>
                        {row.avatar
                          ? <img src={row.avatar} alt="" draggable={false} />
                          : <b aria-hidden="true">{row.label.replace('@', '').slice(0, 1).toUpperCase()}</b>}
                      </span>
                      <span className={styles.name}>
                        <strong>{row.mine ? 'YOU' : row.label}</strong>
                        <em>{row.topPlace} · {row.territories} {row.territories === 1 ? 'area' : 'areas'}</em>
                      </span>
                      <span className={styles.fame}>
                        {row.fame.toLocaleString()}<small>FAME</small>
                      </span>
                      <span className={styles.bar} aria-hidden="true">
                        <i style={{ width: `${Math.max(8, (row.fame / maxFame) * 100)}%` }} />
                      </span>
                    </article>
                  )
                })}
              </div>
              <span className={styles.srOnly}>Leaderboard pages rotate automatically.</span>
            </>
          ) : (
            <div className={styles.empty} role="status">
              <strong>{displaySnapshot ? 'No conquered areas in view' : 'Conquer standings loading'}</strong>
              <span>{displaySnapshot
                ? 'Return to the map and move to an area with active takeovers.'
                : 'The complete board is ready; live rankings will appear as soon as this map reports them.'}</span>
            </div>
          )}
          </>}
        </div>
      </section>
      {!onClose && <p className={styles.cubeHint}>TAP THE CUBE TO RETURN TO MAP</p>}
    </main>
  )
}
