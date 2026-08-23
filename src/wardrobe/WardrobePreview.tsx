import { useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type {
  WardrobeCharacterAppearance,
  WardrobeModule,
  WardrobeScene,
  WardrobeTransform,
} from './wardrobeTypes'
import {
  assetSource,
  getWardrobeAsset,
  hasWardrobeAssetArt,
  wardrobeFallbackGlyph,
  wardrobeFallbackTone,
} from './wardrobeAssets'
import { anchorOffset } from './wardrobeTransforms'
import { resolveWardrobeTransforms } from './wardrobeCommands'
import { poplurFromAppearance } from './wardrobeCharacter'
import type { PoplurCharacter } from '../characterStore'
import {
  REFERENCE_WARDROBE_ASSETS,
  referenceWardrobeCharacter,
  wardrobeInitialCharacter,
} from '../ReferenceWardrobeCharacter'
import WardrobeRenderer from './WardrobeRenderer'
import { playPop } from '../pop'
import styles from './WardrobeBuilder.module.css'

type ThumbnailCanvas = HTMLCanvasElement | OffscreenCanvas

function createThumbnailCanvas(width: number, height: number): ThumbnailCanvas {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  throw new Error('generateWardrobeThumbnail needs a DOM or OffscreenCanvas environment')
}

async function canvasToDataUrl(canvas: ThumbnailCanvas): Promise<string> {
  if ('toDataURL' in canvas) return canvas.toDataURL('image/png')
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:image/png;base64,${btoa(binary)}`
}

function nextPaint(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve()
  // One-shot paint boundary during an explicit Share capture.
  // governor-ok: never re-arms itself and performs zero work while the wardrobe idles.
  return new Promise(resolve => requestAnimationFrame(() => resolve()))
}

async function settleStage(stage: HTMLElement): Promise<void> {
  if (typeof document !== 'undefined' && 'fonts' in document) {
    await document.fonts.ready.catch(() => undefined)
  }
  await Promise.all([...stage.querySelectorAll('img')].map(async image => {
    if (!image.complete) {
      await new Promise<void>(resolve => {
        image.addEventListener('load', () => resolve(), { once: true })
        image.addEventListener('error', () => resolve(), { once: true })
      })
    }
    if (image.naturalWidth > 0 && typeof image.decode === 'function') {
      await image.decode().catch(() => undefined)
    }
  }))
  // Image errors update React state to CSS fallbacks. Two paints allow those
  // commits plus ResizeObserver's character measurement to settle.
  await nextPaint()
  await nextPaint()
}

function blobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read wardrobe image'))
    reader.readAsDataURL(blob)
  })
}

async function inlineImageSources(stage: HTMLElement): Promise<Map<string, string>> {
  const sources = new Set<string>()
  for (const image of stage.querySelectorAll('img')) {
    if (image.naturalWidth <= 0) continue
    const source = image.currentSrc || image.src
    if (!source || source.startsWith('data:') || source.startsWith('blob:')) continue
    sources.add(new URL(source, document.baseURI).href)
  }
  const inlined = new Map<string, string>()
  await Promise.all([...sources].map(async source => {
    try {
      const response = await fetch(source)
      if (!response.ok) return
      inlined.set(source, await blobAsDataUrl(await response.blob()))
    } catch {
      // The renderer already has a visual fallback for failed asset images.
    }
  }))
  return inlined
}

function replaceStyleUrls(value: string, inlined: Map<string, string>): string {
  return value.replace(/url\((['"]?)(.*?)\1\)/g, (whole, _quote: string, raw: string) => {
    if (raw.startsWith('data:') || raw.startsWith('blob:')) return whole
    try {
      const absolute = new URL(raw, document.baseURI).href
      const data = inlined.get(absolute)
      return data ? `url("${data}")` : whole
    } catch {
      return whole
    }
  })
}

function computedCss(
  source: Element,
  inlined: Map<string, string>,
  pseudo?: '::before' | '::after',
): string {
  const style = getComputedStyle(source, pseudo)
  let css = ''
  for (let i = 0; i < style.length; i += 1) {
    const property = style.item(i)
    const value = replaceStyleUrls(style.getPropertyValue(property), inlined)
    if (!value) continue
    css += `${property}:${value}${style.getPropertyPriority(property) ? ' !important' : ''};`
  }
  return `${css}animation:none !important;transition:none !important;`
}

function copyPseudo(
  source: Element,
  target: Element,
  inlined: Map<string, string>,
  pseudo: '::before' | '::after',
): void {
  const style = getComputedStyle(source, pseudo)
  const content = style.content
  if (!content || content === 'none' || content === 'normal') return
  const node = document.createElement('span')
  node.setAttribute('aria-hidden', 'true')
  node.style.cssText = computedCss(source, inlined, pseudo)
  node.style.setProperty('content', 'none', 'important')
  const literal = content.match(/^(['"])(.*)\1$/)?.[2]
  if (literal) node.textContent = literal
  if (pseudo === '::before') target.insertBefore(node, target.firstChild)
  else target.appendChild(node)
}

/** Clone the already-rendered preview and freeze every computed style. This
    preserves code-native fallbacks, radial lights, tint masks, and the live
    supplied-character SVG/layers instead of rebuilding a second renderer. */
async function cloneStageForCapture(stage: HTMLElement): Promise<HTMLElement> {
  await settleStage(stage)
  const inlined = await inlineImageSources(stage)
  const clone = stage.cloneNode(true) as HTMLElement
  const sources: Element[] = [stage, ...stage.querySelectorAll('*')]
  const targets: Element[] = [clone, ...clone.querySelectorAll('*')]
  for (let i = 0; i < sources.length; i += 1) {
    const source = sources[i]
    const target = targets[i]
    if (!target) continue
    target.setAttribute('style', computedCss(source, inlined))
    if (source instanceof HTMLImageElement && target instanceof HTMLImageElement) {
      if (source.naturalWidth <= 0) {
        target.remove()
      } else {
        const absolute = new URL(source.currentSrc || source.src, document.baseURI).href
        const data = inlined.get(absolute)
        if (data) target.src = data
      }
    }
  }
  // CSS pseudo-elements are not part of cloneNode/outerHTML. Materialise the
  // useful ones (fallback highlights, bag handles) as ordinary frozen spans.
  for (let i = 0; i < sources.length; i += 1) {
    const target = targets[i]
    if (!target || (target !== clone && !target.parentNode)) continue
    copyPseudo(sources[i], target, inlined, '::before')
    copyPseudo(sources[i], target, inlined, '::after')
  }
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
  return clone
}

function loadRaster(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not decode wardrobe capture'))
    image.src = source
  })
}

async function captureStage(
  stage: HTMLElement,
  canvas: ThumbnailCanvas,
  ctx: CanvasRenderingContext2D,
): Promise<void> {
  const clone = await cloneStageForCapture(stage)
  const rect = stage.getBoundingClientRect()
  const sourceWidth = Math.max(1, rect.width)
  const sourceHeight = Math.max(1, rect.height)
  const markup = new XMLSerializer().serializeToString(clone)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sourceWidth}" height="${sourceHeight}" viewBox="0 0 ${sourceWidth} ${sourceHeight}"><foreignObject width="100%" height="100%">${markup}</foreignObject></svg>`
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = await loadRaster(url)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function legacySrgb(value: string): string {
  return value.replace(
    /color\(srgb\s+([+-]?(?:\d+\.?\d*|\.\d+))\s+([+-]?(?:\d+\.?\d*|\.\d+))\s+([+-]?(?:\d+\.?\d*|\.\d+))(?:\s*\/\s*([+-]?(?:\d+\.?\d*|\.\d+)))?\s*\)/gi,
    (_whole, red: string, green: string, blue: string, alpha?: string) => {
      const channel = (raw: string) => Math.round(Math.min(1, Math.max(0, Number(raw))) * 255)
      const opacity = alpha == null ? 1 : Math.min(1, Math.max(0, Number(alpha)))
      return opacity < 1
        ? `rgba(${channel(red)}, ${channel(green)}, ${channel(blue)}, ${opacity})`
        : `rgb(${channel(red)}, ${channel(green)}, ${channel(blue)})`
    },
  )
}

const CAPTURE_COLOUR_PROPERTIES = [
  'background-color',
  'background-image',
  'border-bottom-color',
  'border-left-color',
  'border-right-color',
  'border-top-color',
  'box-shadow',
  'caret-color',
  'color',
  'column-rule-color',
  'fill',
  'outline-color',
  'stroke',
  'text-decoration-color',
  'text-emphasis-color',
  'text-shadow',
  '-webkit-text-stroke-color',
] as const

/** html2canvas 1.x predates CSS Color 4. WebKit exposes resolved color-mix()
    values as color(srgb …), so freeze just those declarations into legacy
    rgb()/rgba() syntax inside html2canvas's private cloned document. */
function normaliseCaptureColours(clonedDocument: Document, clonedRoot?: HTMLElement): void {
  // html2canvas clones the whole page; the builder and its preview can both
  // contain a wardrobe stage. Prefer the exact cloned element it is about to
  // rasterise instead of normalising whichever stage happens to come first.
  const root = clonedRoot
    ?? clonedDocument.querySelector<HTMLElement>('[data-wardrobe-stage="true"]')
  const view = clonedDocument.defaultView
  if (!root || !view) return
  for (const element of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    const computed = view.getComputedStyle(element)
    // These are the colour-bearing declarations html2canvas parses. Limiting
    // the pass avoids tens of thousands of getPropertyValue calls on iPhone.
    for (const property of CAPTURE_COLOUR_PROPERTIES) {
      const value = computed.getPropertyValue(property)
      if (!value.includes('color(')) continue
      const legacy = legacySrgb(value)
      if (legacy !== value) element.style.setProperty(property, legacy, computed.getPropertyPriority(property))
    }
  }
}

/** Render the live stage with a DOM-aware canvas renderer. Unlike drawing a
    foreignObject SVG, this path keeps the output origin-clean in WebKit and
    Chromium while preserving CSS gradients, borders, shadows, pseudo-elements
    and the inline supplied-character SVG. The dependency is lazy so the editor's
    normal open/edit path does not pay for thumbnail rendering. */
async function captureStageDom(
  stage: HTMLElement,
  canvas: ThumbnailCanvas,
  ctx: CanvasRenderingContext2D,
): Promise<void> {
  const { default: html2canvas } = await import('html2canvas')
  await settleStage(stage)
  const rect = stage.getBoundingClientRect()
  const sourceWidth = Math.max(1, rect.width)
  // The live stage is already at least as wide as the 512px share card. One
  // raster pixel per CSS pixel stays crisp after the small final downsample
  // and avoids a costly 2x intermediate surface on mobile.
  const scale = Math.max(1, Math.min(1.25, canvas.width / sourceWidth))
  const raster = await html2canvas(stage, {
    allowTaint: false,
    backgroundColor: null,
    logging: false,
    onclone: (clonedDocument, clonedRoot) => normaliseCaptureColours(clonedDocument, clonedRoot),
    removeContainer: true,
    scale,
    useCORS: true,
  })
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(raster, 0, 0, canvas.width, canvas.height)
}

async function mountCaptureStage(
  scene: WardrobeScene,
  width: number,
  height: number,
): Promise<{ stage: HTMLElement, root: Root, host: HTMLDivElement }> {
  const host = document.createElement('div')
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;pointer-events:none;z-index:-1;`
  document.body.appendChild(host)
  const root = createRoot(host)
  root.render(<WardrobeRenderer scene={scene} mode='preview' />)
  await nextPaint()
  await nextPaint()
  const stage = host.querySelector<HTMLElement>('[data-wardrobe-stage="true"]')
  if (!stage) {
    root.unmount()
    host.remove()
    throw new Error('Wardrobe preview stage did not mount')
  }
  return { stage, root, host }
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + width - r, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + r)
  ctx.lineTo(x + width, y + height - r)
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  ctx.lineTo(x + r, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function drawFallback(
  ctx: CanvasRenderingContext2D,
  module: WardrobeModule,
  width: number,
  height: number,
): void {
  const tone = module.tint || wardrobeFallbackTone(module.assetId, module.type)
  ctx.fillStyle = tone
  roundedRect(ctx, -width / 2, -height / 2, width, height, Math.min(width, height) * 0.12)
  ctx.fill()
  if (['shelf', 'rail', 'divider', 'floor'].includes(module.type)) return
  ctx.fillStyle = '#fff4fa'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `900 ${Math.max(9, Math.min(width, height) * 0.42)}px system-ui, sans-serif`
  ctx.fillText(wardrobeFallbackGlyph(module.type), 0, 0, width * 0.8)
}

function drawLight(
  ctx: CanvasRenderingContext2D,
  module: WardrobeModule,
  width: number,
  height: number,
): void {
  const color = module.tint || '#ff2d9a'
  const intensity = typeof module.properties?.intensity === 'number'
    ? module.properties.intensity
    : 0.85
  const radius = Math.max(width, height) * 0.6
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius)
  gradient.addColorStop(0, color)
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.globalAlpha *= Math.min(1, Math.max(0, intensity))
  ctx.fillStyle = gradient
  ctx.fillRect(-width / 2, -height / 2, width, height)
}

function drawReferenceCharacter(
  ctx: CanvasRenderingContext2D,
  module: WardrobeModule,
  width: number,
  height: number,
  images: Map<string, HTMLImageElement>,
): void {
  const raw = module.properties?.appearance
  const character: PoplurCharacter = wardrobeInitialCharacter(raw && typeof raw === 'object'
    ? poplurFromAppearance(raw as WardrobeCharacterAppearance)
    : referenceWardrobeCharacter())
  const base = images.get(REFERENCE_WARDROBE_ASSETS.base)
  if (!base) return
  const characterWidth = Math.min(width, height * (206 / 295))
  const characterHeight = characterWidth * (295 / 206)
  const left = -characterWidth / 2
  const top = -characterHeight / 2
  ctx.save()
  ctx.drawImage(
    base,
    left + characterWidth * (3 / 206),
    top,
    characterWidth * (200 / 206),
    characterHeight,
  )
  if (character.outfit?.hairFront !== 'none') {
    const hair = images.get(REFERENCE_WARDROBE_ASSETS.hair)
    if (hair) {
      ctx.drawImage(
        hair,
        left + characterWidth * (1 / 206),
        top,
        characterWidth * (204 / 206),
        characterHeight,
      )
    }
  }
  if (character.outfit?.glasses !== 'none') {
    const glasses = images.get(REFERENCE_WARDROBE_ASSETS.glasses)
    if (glasses) {
      ctx.drawImage(
        glasses,
        24,
        91,
        166,
        73,
        left + characterWidth * (72 / 206),
        top + characterHeight * (64 / 295),
        characterWidth * (62 / 206),
        characterHeight * (28 / 295),
      )
    }
  }
  ctx.restore()
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
): void {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight)
  const sourceWidth = width / scale
  const sourceHeight = height / scale
  const sx = (image.naturalWidth - sourceWidth) / 2
  const sy = (image.naturalHeight - sourceHeight) / 2
  ctx.drawImage(image, sx, sy, sourceWidth, sourceHeight, 0, 0, width, height)
}

async function loadSceneImages(scene: WardrobeScene): Promise<Map<string, HTMLImageElement>> {
  const loaded = new Map<string, HTMLImageElement>()
  if (typeof Image === 'undefined') return loaded
  const sources = new Set<string>()
  const background = scene.canvas.backgroundAssetId
    ? getWardrobeAsset(scene.canvas.backgroundAssetId)
    : undefined
  if (background && hasWardrobeAssetArt(background)) sources.add(assetSource(background))
  for (const module of scene.modules) {
    if (module.visible === false || module.type === 'light') continue
    if (module.type === 'character') {
      sources.add(REFERENCE_WARDROBE_ASSETS.base)
      sources.add(REFERENCE_WARDROBE_ASSETS.hair)
      sources.add(REFERENCE_WARDROBE_ASSETS.glasses)
      continue
    }
    const asset = getWardrobeAsset(module.assetId)
    if (asset && hasWardrobeAssetArt(asset)) sources.add(assetSource(asset))
  }
  await Promise.all([...sources].map(source => new Promise<void>(resolve => {
    const image = new Image()
    image.onload = () => {
      loaded.set(source, image)
      resolve()
    }
    image.onerror = () => resolve()
    image.src = source
  })))
  return loaded
}

/** Canvas-only safety path for browsers that reject SVG foreignObject and for
    OffscreenCanvas runtimes. It still includes attachments, background art,
    code-native fallbacks, lights, and the scene's current character. */
async function paintSceneFallback(
  scene: WardrobeScene,
  canvas: ThumbnailCanvas,
  ctx: CanvasRenderingContext2D,
): Promise<void> {
  const width = canvas.width
  const height = canvas.height
  ctx.fillStyle = scene.canvas.backgroundColor ?? '#111111'
  ctx.fillRect(0, 0, width, height)
  const images = await loadSceneImages(scene)
  const background = scene.canvas.backgroundAssetId
    ? getWardrobeAsset(scene.canvas.backgroundAssetId)
    : undefined
  const backgroundImage = background && hasWardrobeAssetArt(background)
    ? images.get(assetSource(background))
    : undefined
  if (backgroundImage) drawImageCover(ctx, backgroundImage, width, height)

  const world = resolveWardrobeTransforms(scene)
  const ordered = scene.modules
    .map((module, index) => ({ module, index }))
    .filter(({ module }) => module.visible !== false)
    .sort((a, b) => (a.module.layer - b.module.layer) || (a.index - b.index))
  for (const { module } of ordered) {
    if (module.properties?.isGroup === true || module.type === 'particleEffect') continue
    const transform: WardrobeTransform = world[module.id] ?? module.transform
    const asset = getWardrobeAsset(module.assetId)
    const offset = anchorOffset(asset?.anchor, transform)
    const moduleWidth = transform.width * width * (transform.scaleX ?? 1)
    const moduleHeight = transform.height * height * (transform.scaleY ?? 1)
    if (moduleWidth <= 0 || moduleHeight <= 0) continue
    const left = (transform.x - offset.x) * width
    const top = (transform.y - offset.y) * height
    ctx.save()
    ctx.globalAlpha = Math.min(1, Math.max(0, module.opacity ?? 1))
    ctx.translate(left + moduleWidth / 2, top + moduleHeight / 2)
    if (transform.rotation) ctx.rotate((transform.rotation * Math.PI) / 180)
    if (module.type === 'light') {
      drawLight(ctx, module, moduleWidth, moduleHeight)
    } else if (module.type === 'character') {
      drawReferenceCharacter(ctx, module, moduleWidth, moduleHeight, images)
    } else {
      const image = asset && hasWardrobeAssetArt(asset)
        ? images.get(assetSource(asset))
        : undefined
      if (image) ctx.drawImage(image, -moduleWidth / 2, -moduleHeight / 2, moduleWidth, moduleHeight)
      else drawFallback(ctx, module, moduleWidth, moduleHeight)
    }
    ctx.restore()
  }
}

/** Rasterises the actual WardrobeRenderer to a PNG data URI. Passing the live
    preview stage avoids a duplicate render; callers outside React get a
    temporary off-screen stage. A DOM-aware renderer is preferred, followed by
    SVG/foreignObject and finally the deterministic scene canvas renderer. */
export async function generateWardrobeThumbnail(
  scene: WardrobeScene,
  size = 512,
  sourceStage?: HTMLElement | null,
): Promise<string> {
  const aspect = scene.canvas.width > 0 && scene.canvas.height > 0
    ? scene.canvas.height / scene.canvas.width
    : 1
  const width = Math.max(1, Math.round(size))
  const height = Math.max(1, Math.round(size * aspect))

  let mounted: Awaited<ReturnType<typeof mountCaptureStage>> | null = null
  if (typeof document !== 'undefined' && typeof XMLSerializer !== 'undefined') {
    try {
      mounted = sourceStage ? null : await mountCaptureStage(scene, width, height)
      const stage = sourceStage ?? mounted?.stage
      if (stage) {
        try {
          const domCanvas = createThumbnailCanvas(width, height)
          const domCtx = domCanvas.getContext('2d') as CanvasRenderingContext2D | null
          if (!domCtx) throw new Error('generateWardrobeThumbnail could not acquire a 2d context')
          await captureStageDom(stage, domCanvas, domCtx)
          return await canvasToDataUrl(domCanvas)
        } catch (error) {
          console.warn('[wardrobe] DOM preview capture failed; trying SVG capture', error)
        }
      }

      // Keep the high-fidelity DOM attempt on its own canvas. WebKit and some
      // Chromium builds can taint a canvas after drawing an SVG containing a
      // foreignObject even when every nested image was fetched and inlined.
      // Once tainted, clearRect cannot make that canvas exportable again, so
      // reusing it for the compatibility renderer would make both paths fail.
      const captureCanvas = createThumbnailCanvas(width, height)
      const captureCtx = captureCanvas.getContext('2d') as CanvasRenderingContext2D | null
      if (!captureCtx) throw new Error('generateWardrobeThumbnail could not acquire a 2d context')
      if (stage) {
        await captureStage(stage, captureCanvas, captureCtx)
        return await canvasToDataUrl(captureCanvas)
      }
    } catch (error) {
      console.warn('[wardrobe] exact preview capture failed; using canvas fallback', error)
    } finally {
      mounted?.root.unmount()
      mounted?.host.remove()
    }
  }

  // Always allocate a fresh origin-clean surface for the fallback. This is
  // deliberately after the DOM attempt so a browser's taint flag can never
  // leak from the preferred capture into the reliable renderer.
  const fallbackCanvas = createThumbnailCanvas(width, height)
  const fallbackCtx = fallbackCanvas.getContext('2d') as CanvasRenderingContext2D | null
  if (!fallbackCtx) throw new Error('generateWardrobeThumbnail could not acquire a 2d context')
  await paintSceneFallback(scene, fallbackCanvas, fallbackCtx)
  return canvasToDataUrl(fallbackCanvas)
}

export default function WardrobePreview({ scene, onExit }: {
  scene: WardrobeScene
  onExit?: () => void
}) {
  const [thumbnail, setThumbnail] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const previewRef = useRef<HTMLDivElement | null>(null)

  const share = () => {
    playPop()
    if (busy) return
    setBusy(true)
    const stage = previewRef.current?.querySelector<HTMLElement>('[data-wardrobe-stage="true"]')
    generateWardrobeThumbnail(scene, 512, stage)
      .then(setThumbnail)
      .catch(err => console.warn('wardrobe thumbnail failed', err))
      .finally(() => setBusy(false))
  }

  return (
    <div className={styles.preview}>
      <div ref={previewRef} className={styles.previewStage}>
        <WardrobeRenderer scene={scene} mode='preview' />
      </div>
      <button
        type='button'
        className={styles.previewExit}
        aria-label='Exit preview'
        onClick={() => {
          playPop()
          onExit?.()
        }}
      >
        &#215;
      </button>
      <button type='button' className={styles.previewShare} onClick={share} disabled={busy}>
        {busy ? 'Rendering…' : 'Share'}
      </button>
      {thumbnail && (
        <div className={styles.thumbOverlay} onClick={() => setThumbnail(null)}>
          <img className={styles.thumbImage} src={thumbnail} alt={`${scene.name} thumbnail`} />
          <span className={styles.thumbHint}>Tap to dismiss</span>
        </div>
      )}
    </div>
  )
}
