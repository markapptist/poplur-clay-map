import { useRef, useEffect, useState, useCallback, memo } from 'react'
import { onFrame } from './frameGovernor'
import { poplurResourcePool, type PoplurResourceLease } from './resourcePool'

const VERT = `attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`

const FRAG = `precision mediump float;
uniform vec2 u_res;
uniform float u_dpr;
uniform float u_progress;
uniform float u_playing;
uniform float u_muted;
uniform float u_show;

float box(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 px = gl_FragCoord.xy / u_dpr;
  vec4 c = vec4(0.0);

  // thin always-visible progress line (bottom 2.5 CSS px)
  if (px.y < 2.5) {
    float t = px.x * u_dpr / u_res.x;
    c = vec4(0.45, 0.42, 0.38, 0.35);
    if (t <= u_progress) c = vec4(0.88, 0.84, 0.78, 0.85);
    float gd = abs(t - u_progress) * u_res.x / u_dpr;
    c.rgb += vec3(1.0, 0.95, 0.88) * exp(-gd * 0.1) * 0.4;
  }

  // control bar (bottom 40 CSS px, fades with u_show)
  if (px.y < 40.0 && u_show > 0.01) {
    float f = u_show;
    float n = hash(floor(gl_FragCoord.xy * 0.4)) * 0.03;
    vec4 bar = vec4(vec3(0.82, 0.78, 0.72) + n, 0.82);
    c = mix(c, bar, f);

    // play / pause icon at (22, 20)
    vec2 pp = px - vec2(22.0, 20.0);
    float icon;
    if (u_playing > 0.5) {
      float b1 = box(pp - vec2(-4.0, 0.0), vec2(1.8, 6.5));
      float b2 = box(pp - vec2(4.0, 0.0), vec2(1.8, 6.5));
      icon = min(b1, b2);
    } else {
      vec2 tp = pp - vec2(1.0, 0.0);
      float d1 = -(tp.x + 5.0);
      float d2 = (7.0 * tp.x - 12.0 * tp.y - 49.0) / 13.89;
      float d3 = (7.0 * tp.x + 12.0 * tp.y - 49.0) / 13.89;
      icon = max(d1, max(d2, d3));
    }
    float ia = (1.0 - smoothstep(-0.5, 1.0, icon)) * f;
    c.rgb = mix(c.rgb, vec3(0.12), ia);
    c.a = max(c.a, ia);

    // progress track
    float csW = u_res.x / u_dpr;
    float tl = 48.0;
    float tr = csW - 48.0;
    if (px.x >= tl && px.x <= tr && abs(px.y - 20.0) < 2.5) {
      float t = (px.x - tl) / (tr - tl);
      vec3 tk = vec3(0.62, 0.58, 0.52);
      if (t <= u_progress) tk = vec3(0.35, 0.32, 0.28);
      float gd = abs(t - u_progress) * (tr - tl);
      tk += vec3(1.0, 0.95, 0.88) * exp(-gd * 0.08) * 0.35;
      c.rgb = mix(c.rgb, tk, f * 0.85);
    }

    // mute icon at (csW - 22, 20)
    vec2 sp = px - vec2(csW - 22.0, 20.0);
    float sb = box(sp + vec2(2.0, 0.0), vec2(2.5, 3.0));
    float sc = box(sp - vec2(2.5, 0.0), vec2(2.0, 5.5));
    float spk = min(sb, sc);
    float sa = (1.0 - smoothstep(-0.5, 1.0, spk)) * f;
    c.rgb = mix(c.rgb, vec3(0.12), sa * 0.85);

    if (u_muted > 0.5) {
      vec2 rp = mat2(0.707, 0.707, -0.707, 0.707) * sp;
      float xl = min(box(rp, vec2(7.0, 1.0)), box(rp, vec2(1.0, 7.0)));
      float xa = (1.0 - smoothstep(-0.5, 1.0, xl)) * f;
      c.rgb = mix(c.rgb, vec3(0.6, 0.18, 0.12), xa * 0.7);
    }

    c.a *= f;
  }
  gl_FragColor = c;
}`

interface Uniforms {
  u_res: WebGLUniformLocation | null
  u_dpr: WebGLUniformLocation | null
  u_progress: WebGLUniformLocation | null
  u_playing: WebGLUniformLocation | null
  u_muted: WebGLUniformLocation | null
  u_show: WebGLUniformLocation | null
}

function initGL(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: false,
    powerPreference: 'low-power',
  })
  if (!gl) return null

  const vs = gl.createShader(gl.VERTEX_SHADER)!
  gl.shaderSource(vs, VERT)
  gl.compileShader(vs)
  const fs = gl.createShader(gl.FRAGMENT_SHADER)!
  gl.shaderSource(fs, FRAG)
  gl.compileShader(fs)

  const prog = gl.createProgram()!
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  gl.useProgram(prog)

  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const aPos = gl.getAttribLocation(prog, 'a_pos')
  gl.enableVertexAttribArray(aPos)
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

  const unis: Uniforms = {
    u_res: gl.getUniformLocation(prog, 'u_res'),
    u_dpr: gl.getUniformLocation(prog, 'u_dpr'),
    u_progress: gl.getUniformLocation(prog, 'u_progress'),
    u_playing: gl.getUniformLocation(prog, 'u_playing'),
    u_muted: gl.getUniformLocation(prog, 'u_muted'),
    u_show: gl.getUniformLocation(prog, 'u_show'),
  }

  return { gl, prog, unis, vs, fs, buf }
}

type ShaderGLContext = NonNullable<ReturnType<typeof initGL>>

/**
 * The video decoder and its decorative shader are one thermal resource. They
 * belong only to a player that is both exposed by its owning surface and
 * actually in the viewport. Keeping this predicate exported makes it hard for
 * an overlay or visibility refactor to accidentally re-open offscreen work.
 */
export function shouldOwnShaderVideoResources({
  active,
  intersecting,
  documentVisible,
  nativeLifecycleKnown,
  nativeAppActive,
  decoderGranted,
}: {
  active: boolean
  intersecting: boolean
  documentVisible: boolean
  nativeLifecycleKnown: boolean
  nativeAppActive: boolean
  decoderGranted: boolean
}): boolean {
  const foreground = nativeLifecycleKnown ? nativeAppActive : documentVisible
  return active && intersecting && foreground && decoderGranted
}

/** Detach the source as well as pausing: WebKit may retain a paused decoder. */
export function retireShaderVideoMedia(video: HTMLVideoElement): number {
  const resumeAt = Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : 0
  video.pause()
  video.removeAttribute('src')
  video.load()
  return resumeAt
}

/** Release all driver allocations and make the canvas cheap while parked. */
export function releaseShaderVideoGL(ctx: ShaderGLContext, canvas: HTMLCanvasElement): void {
  ctx.gl.deleteBuffer(ctx.buf)
  ctx.gl.deleteShader(ctx.vs)
  ctx.gl.deleteShader(ctx.fs)
  ctx.gl.deleteProgram(ctx.prog)
  ctx.gl.getExtension('WEBGL_lose_context')?.loseContext()
  canvas.width = 1
  canvas.height = 1
}

interface Props {
  src: string
  poster?: string
  className?: string
  /** False while an opaque owner (for example News detail) covers this copy. */
  active?: boolean
}

let nextNewsVideoOwner = 0

type ShaderVideoWindow = Window & { __poplurNativeAppActive?: boolean }

function retainedNativeAppActive(): boolean {
  if (typeof window === 'undefined') return true
  return (window as ShaderVideoWindow).__poplurNativeAppActive !== false
}

function retainedNativeLifecycleKnown(): boolean {
  return typeof window !== 'undefined'
    && typeof (window as ShaderVideoWindow).__poplurNativeAppActive === 'boolean'
}

export default memo(function ShaderVideoPlayer({ src, poster, className, active = true }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const glCtx = useRef<ReturnType<typeof initGL>>(null)
  const releaseGLRef = useRef<(() => void) | null>(null)
  const decoderLeaseRef = useRef<PoplurResourceLease | null>(null)
  const ownerRef = useRef('')
  if (!ownerRef.current) ownerRef.current = `news-video-${++nextNewsVideoOwner}`
  const showTarget = useRef(0)
  const showAnim = useRef(0)
  const hideTimer = useRef(0)
  const resumeAtRef = useRef(0)
  const sourceRef = useRef(src)
  const [intersecting, setIntersecting] = useState(false)
  const [documentVisible, setDocumentVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible',
  )
  const [nativeLifecycleKnown, setNativeLifecycleKnown] = useState(retainedNativeLifecycleKnown)
  const [nativeAppActive, setNativeAppActive] = useState(retainedNativeAppActive)
  const [decoderGranted, setDecoderGranted] = useState(false)
  const [leaseEpoch, setLeaseEpoch] = useState(0)
  const [ownershipRequested, setOwnershipRequested] = useState(false)
  const [playing, setPlaying] = useState(false)

  const eligible = shouldOwnShaderVideoResources({
    active,
    intersecting,
    documentVisible,
    nativeLifecycleKnown,
    nativeAppActive,
    decoderGranted: true,
  })
  const ownsLiveResources = shouldOwnShaderVideoResources({
    active,
    intersecting,
    documentVisible,
    nativeLifecycleKnown,
    nativeAppActive,
    decoderGranted,
  })
  const eligibleRef = useRef(eligible)
  eligibleRef.current = eligible

  const parkMediaNow = useCallback(() => {
    const video = videoRef.current
    if (video) resumeAtRef.current = retireShaderVideoMedia(video)
    setPlaying(false)
  }, [])

  const releaseGLNow = useCallback(() => {
    const release = releaseGLRef.current
    releaseGLRef.current = null
    release?.()
  }, [])

  const parkLiveResources = useCallback(() => {
    parkMediaNow()
    releaseGLNow()
  }, [parkMediaNow, releaseGLNow])

  // Intersection decides whether this particular story owns any live work.
  // Observing the wrapper (rather than the video) still works while the source
  // is detached and only its poster is visible.
  useEffect(() => {
    const node = wrapRef.current
    if (!node) return
    if (typeof IntersectionObserver === 'undefined') {
      setIntersecting(true)
      return
    }
    const obs = new IntersectionObserver(
      entries => {
        const entry = entries[0]
        const next = Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.5)
        if (!next) {
          parkLiveResources()
          setOwnershipRequested(false)
        }
        setIntersecting(next)
      },
      { threshold: 0.5 },
    )
    obs.observe(node)
    return () => obs.disconnect()
  }, [parkLiveResources])

  // Page backgrounding is stronger than geometric intersection. Release in
  // the event callback, before React's passive cleanup, so iOS can reclaim the
  // decoder/context immediately during the lifecycle transition.
  useEffect(() => {
    const syncVisibility = () => {
      const retained = (window as ShaderVideoWindow).__poplurNativeAppActive
      if (typeof retained === 'boolean') {
        // Once UIKit has spoken it owns foreground truth. WKWebView may leave
        // visibilityState stale in either direction across a native cover.
        setNativeLifecycleKnown(true)
        setNativeAppActive(retained)
        if (!retained) parkLiveResources()
        return
      }
      const next = document.visibilityState === 'visible'
      if (!next) parkLiveResources()
      setDocumentVisible(next)
    }
    const onPageHide = () => {
      // UIKit is authoritative in the native shell. It can emit a transient
      // WebKit pagehide while keeping the app active; only a retained false
      // lifecycle state proves that this player is truly backgrounded.
      const retained = (window as ShaderVideoWindow).__poplurNativeAppActive
      if (typeof retained === 'boolean') {
        setNativeLifecycleKnown(true)
        setNativeAppActive(retained)
        if (!retained) parkLiveResources()
        return
      }
      parkLiveResources()
      setDocumentVisible(false)
    }
    const onNativeLifecycle = (event: Event) => {
      const next = (event as CustomEvent<{ active?: unknown }>).detail?.active
      if (typeof next !== 'boolean') return
      ;(window as ShaderVideoWindow).__poplurNativeAppActive = next
      if (!next) parkLiveResources()
      setNativeLifecycleKnown(true)
      setNativeAppActive(next)
    }
    document.addEventListener('visibilitychange', syncVisibility)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', syncVisibility)
    window.addEventListener('poplur-native-app-lifecycle', onNativeLifecycle)
    return () => {
      document.removeEventListener('visibilitychange', syncVisibility)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', syncVisibility)
      window.removeEventListener('poplur-native-app-lifecycle', onNativeLifecycle)
    }
  }, [parkLiveResources])

  // The app-wide decoder pool gives News one foreground decoder even if two
  // cards straddle the viewport. A direct tap can take ownership from another
  // News card, while News detail naturally takes it from the covered edition.
  useEffect(() => {
    if (!eligible) {
      decoderLeaseRef.current?.release()
      decoderLeaseRef.current = null
      setDecoderGranted(false)
      parkLiveResources()
      return
    }

    let lease: PoplurResourceLease | null = null
    lease = poplurResourcePool.acquire('media-decoder', ownerRef.current, {
      priority: ownershipRequested ? 130 : 110,
      onRevoke: () => {
        if (decoderLeaseRef.current === lease) decoderLeaseRef.current = null
        parkLiveResources()
        setDecoderGranted(false)
      },
    })
    decoderLeaseRef.current = lease
    setDecoderGranted(Boolean(lease))

    return () => {
      parkLiveResources()
      lease?.release()
      if (decoderLeaseRef.current === lease) decoderLeaseRef.current = null
    }
  }, [eligible, leaseEpoch, ownershipRequested, parkLiveResources])

  // A visible candidate that lost a same-priority race retries as soon as the
  // current owner retires. Deferring one task lets all visibility cleanups
  // finish first and prevents decoder overlap during a story/list handoff.
  useEffect(() => {
    if (!eligible || decoderGranted) return
    let retryTimer = 0
    const onPoolChange = () => {
      if (retryTimer) return
      retryTimer = window.setTimeout(() => {
        retryTimer = 0
        if (eligibleRef.current && !decoderLeaseRef.current) {
          setLeaseEpoch(value => value + 1)
        }
      }, 0)
    }
    window.addEventListener('poplur-resource-pool-change', onPoolChange)
    return () => {
      window.removeEventListener('poplur-resource-pool-change', onPoolChange)
      if (retryTimer) window.clearTimeout(retryTimer)
    }
  }, [eligible, decoderGranted])

  // Attach a source only after this card owns the sole decoder. Source removal
  // is what actually retires WebKit's pipeline; pause alone is insufficient.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (sourceRef.current !== src) {
      sourceRef.current = src
      resumeAtRef.current = 0
    }
    if (!ownsLiveResources) {
      parkMediaNow()
      return
    }

    let cancelled = false
    const start = () => {
      if (cancelled || !videoRef.current) return
      const resumeAt = resumeAtRef.current
      if (resumeAt > 0 && Number.isFinite(video.duration) && video.duration > 0) {
        video.currentTime = Math.min(resumeAt, Math.max(0, video.duration - 0.05))
      }
      void video.play().catch(() => { /* poster/play affordance remains */ })
    }

    video.setAttribute('src', src)
    video.load()
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) start()
    else video.addEventListener('loadedmetadata', start, { once: true })

    return () => {
      cancelled = true
      video.removeEventListener('loadedmetadata', start)
      parkMediaNow()
    }
  }, [ownsLiveResources, src, parkMediaNow])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !ownsLiveResources) {
      releaseGLNow()
      return
    }
    const ctx = initGL(canvas)
    glCtx.current = ctx
    if (!ctx) return

    // Continuous WebGL work belongs to the frame governor, not a self-
    // rescheduling rAF chain: `ambient` lets this overlay drop rate with the
    // rest of the app and park outright when the surface goes idle, which a raw
    // loop cannot do. (scripts/verify-governed-loops.mjs enforces this.)
    const stop = onFrame(() => {
      const video = videoRef.current
      if (glCtx.current !== ctx || !video || !canvas) return

      const { gl, unis } = ctx
      // This canvas is a translucent decorative control treatment, not source
      // video. One CSS pixel per backing pixel halves each Retina dimension and
      // quarters its fill cost without touching the video itself.
      const dpr = Math.min(window.devicePixelRatio || 1, 1)
      const w = Math.round(canvas.clientWidth * dpr)
      const h = Math.round(canvas.clientHeight * dpr)
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
      gl.viewport(0, 0, w, h)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)

      showAnim.current += (showTarget.current - showAnim.current) * 0.12
      if (Math.abs(showAnim.current - showTarget.current) < 0.01) showAnim.current = showTarget.current

      const progress = video.duration > 0 && isFinite(video.duration) ? video.currentTime / video.duration : 0

      gl.uniform2f(unis.u_res, w, h)
      gl.uniform1f(unis.u_dpr, dpr)
      gl.uniform1f(unis.u_progress, progress)
      gl.uniform1f(unis.u_playing, video.paused ? 0 : 1)
      gl.uniform1f(unis.u_muted, video.muted ? 1 : 0)
      gl.uniform1f(unis.u_show, showAnim.current)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

      if (timeRef.current) {
        const dur = video.duration || 0
        if (dur > 0 && isFinite(dur) && showAnim.current > 0.3) {
          const fmt = (t: number) => {
            const m = Math.floor(t / 60)
            const s = Math.floor(t % 60)
            return `${m}:${s.toString().padStart(2, '0')}`
          }
          timeRef.current.textContent = `${fmt(video.currentTime)} / ${fmt(dur)}`
          timeRef.current.style.opacity = String(Math.min(1, showAnim.current * 1.5))
        } else {
          timeRef.current.style.opacity = '0'
        }
      }
    })

    let released = false
    const release = () => {
      if (released) return
      released = true
      stop()
      if (glCtx.current === ctx) glCtx.current = null
      releaseShaderVideoGL(ctx, canvas)
    }
    releaseGLRef.current = release

    return () => {
      if (releaseGLRef.current === release) releaseGLRef.current = null
      release()
    }
  }, [ownsLiveResources, releaseGLNow])

  useEffect(() => () => {
    window.clearTimeout(hideTimer.current)
    hideTimer.current = 0
    decoderLeaseRef.current?.release()
    decoderLeaseRef.current = null
    parkLiveResources()
  }, [parkLiveResources])

  const revealControls = useCallback(() => {
    showTarget.current = 1
    clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => { showTarget.current = 0 }, 3000)
  }, [])

  const handleClick = useCallback((e: React.MouseEvent) => {
    const video = videoRef.current
    const wrap = wrapRef.current
    if (!video || !wrap) return

    // A visible poster that lost the one-decoder race becomes the explicit
    // owner when tapped. Its source is attached and autoplayed by the ownership
    // effect, preserving the existing tap-to-play affordance.
    if (!ownsLiveResources) {
      if (eligible) setOwnershipRequested(true)
      revealControls()
      return
    }

    const rect = wrap.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const w = rect.width
    const h = rect.height

    revealControls()

    if (y > h - 40 && showAnim.current > 0.3) {
      e.stopPropagation()
      if (x < 44) {
        if (video.paused) video.play().catch(() => {})
        else video.pause()
      } else if (x > w - 44) {
        video.muted = !video.muted
      } else {
        const ratio = Math.max(0, Math.min(1, (x - 48) / (w - 96)))
        if (video.duration > 0 && isFinite(video.duration)) video.currentTime = ratio * video.duration
      }
      return
    }

    if (video.paused) video.play().catch(() => {})
    else video.pause()
  }, [eligible, ownsLiveResources, revealControls])

  return (
    <div
      ref={wrapRef}
      className={className}
      onClick={handleClick}
      onPointerMove={revealControls}
      onPointerLeave={() => { showTarget.current = 0 }}
      style={{ position: 'relative', cursor: 'pointer', overflow: 'hidden', borderRadius: 12 }}
    >
      <video
        ref={videoRef}
        poster={poster}
        muted
        playsInline
        loop
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        style={{ display: 'block', width: '100%', aspectRatio: '16/9', objectFit: 'cover', background: '#111' }}
      />
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          pointerEvents: 'none',
        }}
      />
      <span
        ref={timeRef}
        style={{
          position: 'absolute', bottom: 8, left: 52, pointerEvents: 'none',
          color: 'rgba(21,18,14,0.85)', fontSize: 11, fontWeight: 600,
          fontFamily: 'system-ui, sans-serif',
          textShadow: '0 0 4px rgba(210,200,185,0.5)',
          opacity: 0, transition: 'none',
        }}
      />
      {!playing && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
        }}>
          <div style={{
            width: 52, height: 52, borderRadius: '50%',
            background: 'rgba(210,200,185,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M8 5.5v13l11-6.5L8 5.5z" fill="rgba(21,18,14,0.85)" />
            </svg>
          </div>
        </div>
      )}
    </div>
  )
})
