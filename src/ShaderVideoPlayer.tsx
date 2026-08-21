import { useRef, useEffect, useState, useCallback, memo } from 'react'

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
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false })
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

interface Props {
  src: string
  poster?: string
  className?: string
}

export default memo(function ShaderVideoPlayer({ src, poster, className }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const glCtx = useRef<ReturnType<typeof initGL>>(null)
  const rafId = useRef(0)
  const showTarget = useRef(0)
  const showAnim = useRef(0)
  const hideTimer = useRef(0)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const obs = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) video.play().catch(() => {})
        else video.pause()
      },
      { threshold: 0.5 },
    )
    obs.observe(video)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    glCtx.current = initGL(canvas)
    if (!glCtx.current) return

    let active = true
    const render = () => {
      if (!active) return
      const ctx = glCtx.current
      const video = videoRef.current
      if (!ctx || !video || !canvas) { rafId.current = requestAnimationFrame(render); return }

      const { gl, unis } = ctx
      const dpr = window.devicePixelRatio || 1
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

      rafId.current = requestAnimationFrame(render)
    }
    rafId.current = requestAnimationFrame(render)

    return () => {
      active = false
      cancelAnimationFrame(rafId.current)
      const c = glCtx.current
      if (c) {
        c.gl.deleteBuffer(c.buf)
        c.gl.deleteShader(c.vs)
        c.gl.deleteShader(c.fs)
        c.gl.deleteProgram(c.prog)
        glCtx.current = null
      }
    }
  }, [])

  const revealControls = useCallback(() => {
    showTarget.current = 1
    clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => { showTarget.current = 0 }, 3000)
  }, [])

  const handleClick = useCallback((e: React.MouseEvent) => {
    const video = videoRef.current
    const wrap = wrapRef.current
    if (!video || !wrap) return

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
  }, [revealControls])

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
        src={src}
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
