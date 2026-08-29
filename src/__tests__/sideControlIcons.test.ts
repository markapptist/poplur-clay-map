import { Children, createElement, type ReactElement, type ReactNode } from 'react'
import { existsSync, readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../pop', () => ({ playPop: vi.fn() }))

import CameraARButton from '../CameraARButton'
import CameraScanButton from '../CameraScanButton'
import ClayChannelArrows from '../ClayChannelArrows'
import {
  MAP_COLOR_CONTROL_GAP,
  channelControlImageSize,
  mapSideControlRailSpan,
  mapSideControlRailWithColorSpan,
  responsiveChannelControlSize,
} from '../channelControlSizing'
import ConquerGlance from '../ConquerGlance'
import MapConquerButton from '../MapConquerButton'
import MapNewsButton from '../MapNewsButton'
import { mapNewsOpenMessage, readMapNewsOpenRequest } from '../mapNewsBridge'
import PoplurChannelRail from '../PoplurChannelRail'
import PostActionRail from '../PostActionRail'
import SideControlIconButton from '../SideControlIcon'
import { playPop } from '../pop'
import {
  POPLUR_SIDE_ICONS,
  SIDE_CONTROL_ICON_IDS,
  SIDE_CONTROL_ICONS,
  SIDE_ICON_MANIFEST,
  WEATHER_ICON_IDS,
  WEATHER_ICONS,
  runtimeSideIconSources,
  sideIconAssetPath,
  weatherIconIdForCondition,
  weatherIconIdForMode,
  type PoplurSideIconId,
  type PoplurSideIconSize,
} from '../sideControlIcons'

const ALL_IDS = [...SIDE_CONTROL_ICON_IDS, ...WEATHER_ICON_IDS] as const
const SIZES = [256, 512, 1024] as const satisfies readonly PoplurSideIconSize[]

type LooseElement = ReactElement<Record<string, unknown>>

function assetFile(id: PoplurSideIconId, size: PoplurSideIconSize) {
  const path = sideIconAssetPath(id, size)
  return new URL(path.startsWith('src/') ? `../../${path}` : `../../public/${path}`, import.meta.url)
}

function pngHeader(file: URL) {
  const bytes = readFileSync(file)
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  const bitDepth = bytes[24]
  const colourType = bytes[25]
  const interlace = bytes[28]
  const idat: Buffer[] = []
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii')
    if (type === 'IDAT') idat.push(bytes.subarray(offset + 8, offset + 8 + length))
    offset += 12 + length
    if (type === 'IEND') break
  }
  const decoded = inflateSync(Buffer.concat(idat))
  // All supplied files are non-interlaced 8-bit RGBA. For the first pixel of
  // the first scanline every PNG filter has zero left/up predictors, so byte
  // four is the reconstructed alpha without decoding the whole image matrix.
  return {
    width,
    height,
    bitDepth,
    colourType,
    interlace,
    firstPixelAlpha: decoded[4],
  }
}

function pngAlphaAt(file: URL, x: number, y: number) {
  const bytes = readFileSync(file)
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  const idat: Buffer[] = []
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii')
    if (type === 'IDAT') idat.push(bytes.subarray(offset + 8, offset + 8 + length))
    offset += 12 + length
    if (type === 'IEND') break
  }

  const filtered = inflateSync(Buffer.concat(idat))
  const stride = width * 4
  const rgba = Buffer.alloc(stride * height)
  let source = 0
  const paeth = (left: number, up: number, upperLeft: number) => {
    const estimate = left + up - upperLeft
    const leftDistance = Math.abs(estimate - left)
    const upDistance = Math.abs(estimate - up)
    const upperLeftDistance = Math.abs(estimate - upperLeft)
    return leftDistance <= upDistance && leftDistance <= upperLeftDistance
      ? left
      : upDistance <= upperLeftDistance ? up : upperLeft
  }

  for (let row = 0; row < height; row += 1) {
    const filter = filtered[source++]
    const destination = row * stride
    for (let column = 0; column < stride; column += 1) {
      const left = column >= 4 ? rgba[destination + column - 4] : 0
      const up = row > 0 ? rgba[destination - stride + column] : 0
      const upperLeft = row > 0 && column >= 4 ? rgba[destination - stride + column - 4] : 0
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? up
            : filter === 3 ? Math.floor((left + up) / 2)
              : filter === 4 ? paeth(left, up, upperLeft)
                : (() => { throw new Error(`Unsupported PNG filter ${filter}`) })()
      rgba[destination + column] = (filtered[source++] + predictor) & 255
    }
  }

  return rgba[y * stride + x * 4 + 3]
}

describe('Poplur side-control asset registry', () => {
  it('contains the exact 35 control IDs and 14 weather IDs from the package', () => {
    expect(SIDE_CONTROL_ICON_IDS).toHaveLength(35)
    expect(WEATHER_ICON_IDS).toHaveLength(14)
    expect(new Set(ALL_IDS).size).toBe(49)
    expect(Object.keys(POPLUR_SIDE_ICONS).sort()).toEqual([...ALL_IDS].sort())
    expect(SIDE_ICON_MANIFEST.buttonCount).toBe(35)
    expect(SIDE_ICON_MANIFEST.weatherConditionCount).toBe(14)
  })

  it('resolves all 147 declared PNGs at their declared dimensions with transparency', () => {
    for (const id of ALL_IDS) {
      for (const size of SIZES) {
        const file = assetFile(id, size)
        expect(existsSync(file), `${id} ${size}px should exist`).toBe(true)
        const png = pngHeader(file)
        expect(png, `${id} ${size}px should be non-interlaced RGBA`).toMatchObject({
          width: size,
          height: size,
          bitDepth: 8,
          colourType: 6,
          interlace: 0,
        })
        expect(png.firstPixelAlpha, `${id} ${size}px should have a transparent canvas corner`)
          .toBeLessThan(255)
      }
    }
  }, 30_000)

  it('uses manifest accessibility labels and keeps artwork decorative', () => {
    for (const id of SIDE_CONTROL_ICON_IDS) {
      const element = SideControlIconButton({ icon: id }) as LooseElement
      expect(element.props['aria-label']).toBe(SIDE_CONTROL_ICONS[id].accessibilityLabel)
      const markup = renderToStaticMarkup(element)
      expect(markup).toContain(`data-side-control-id="${id}"`)
      expect(markup).toContain('alt=""')
      expect(markup).toContain('aria-hidden="true"')
    }
  })

  it('excludes 1024 masters and the baked 105 reference composites at runtime', () => {
    expect(existsSync(new URL('../../public/poplur-side-buttons/assets/1024', import.meta.url))).toBe(false)
    for (const id of ALL_IDS) {
      const sources = runtimeSideIconSources(id)
      expect(`${sources.src} ${sources.srcSet}`).not.toContain('/1024/')
      expect(`${sources.src} ${sources.srcSet}`).not.toContain('105')
      expect(`${sources.src} ${sources.srcSet}`).not.toContain('references')
    }
  })

  it('keeps the channel chevrons opaque without the stray connector bars', () => {
    for (const size of SIZES) {
      const scale = size / 1024
      const up = assetFile('global.channel_up', size)
      const down = assetFile('global.channel_down', size)
      expect(pngAlphaAt(up, Math.round(512 * scale), Math.round(775 * scale))).toBe(0)
      expect(pngAlphaAt(down, Math.round(512 * scale), Math.round(245 * scale))).toBe(0)
      expect(pngAlphaAt(up, Math.round(512 * scale), Math.round(400 * scale))).toBeGreaterThan(240)
      expect(pngAlphaAt(down, Math.round(512 * scale), Math.round(600 * scale))).toBeGreaterThan(240)
    }
  })
})

describe('weather icon normalization', () => {
  it('maps every manifest alias to its typed weather condition', () => {
    for (const id of WEATHER_ICON_IDS) {
      for (const alias of WEATHER_ICONS[id].aliases) {
        expect(weatherIconIdForCondition(alias), alias).toBe(id)
      }
    }
  })

  it('normalizes provider spelling and retains safe current-mode adapters', () => {
    expect(weatherIconIdForCondition('Mostly Sunny')).toBe('weather.partly_cloudy')
    expect(weatherIconIdForCondition('MIST')).toBe('weather.fog')
    expect(weatherIconIdForCondition('rain-and-snow')).toBe('weather.wintry_mix')
    expect(weatherIconIdForCondition('clear_day')).toBe('weather.clear_day')
    expect(weatherIconIdForCondition('rain_showers')).toBe('weather.rain_showers')
    expect(weatherIconIdForCondition('thunder')).toBe('weather.thunderstorm')
    expect(weatherIconIdForCondition('provider_condition_not_known')).toBe('weather.cloudy')
    expect(weatherIconIdForCondition(null)).toBe('weather.cloudy')
    expect(weatherIconIdForMode('storm')).toBe('weather.thunderstorm')
  })
})

describe('replacement controls preserve state and activation contracts', () => {
  it('forwards click, pointer-down, and keyboard activation exactly once', () => {
    const click = vi.fn()
    const clickButton = SideControlIconButton({ icon: 'feed.comment', onActivate: click }) as LooseElement
    ;(clickButton.props.onClick as (event: { detail: number }) => void)({ detail: 1 })
    expect(click).toHaveBeenCalledTimes(1)

    const pointer = vi.fn()
    const pointerButton = SideControlIconButton({
      icon: 'feed.mute',
      activation: 'pointerdown',
      onActivate: pointer,
    }) as LooseElement
    ;(pointerButton.props.onPointerDown as (event: { isPrimary: boolean }) => void)({ isPrimary: true })
    ;(pointerButton.props.onClick as (event: { detail: number }) => void)({ detail: 1 })
    expect(pointer).toHaveBeenCalledTimes(1)
    ;(pointerButton.props.onClick as (event: { detail: number }) => void)({ detail: 0 })
    expect(pointer).toHaveBeenCalledTimes(2)

    const disabled = vi.fn()
    const disabledButton = SideControlIconButton({
      icon: 'feed.share',
      disabled: true,
      onActivate: disabled,
    }) as LooseElement
    ;(disabledButton.props.onClick as (event: { detail: number }) => void)({ detail: 1 })
    expect(disabled).not.toHaveBeenCalled()
  })

  it('propagates supplied selected-state metadata on the shared button shell', () => {
    const stateIds = [
      'map.mute',
      'feed.mute',
      'feed.captions',
      'camera.flash',
      'feed.like',
      'feed.dislike',
      'news.top_latest',
    ] as const
    for (const icon of stateIds) {
      const markup = renderToStaticMarkup(SideControlIconButton({
        icon,
        'aria-pressed': true,
        'aria-label': `${icon} on`,
      }))
      expect(markup).toContain('aria-pressed="true"')
      expect(markup).toContain(`aria-label="${icon} on"`)
    }
  })

  it('keeps all seven Feed callbacks attached to their original semantic slots', () => {
    const handlers = Array.from({ length: 7 }, () => vi.fn())
    const rail = PostActionRail({
      side: 'left',
      label: 'Feed controls',
      muted: true,
      captionsOn: false,
      commentsAtEnd: true,
      onToggleMute: handlers[0],
      onShare: handlers[1],
      onToggleCaptions: handlers[2],
      onToggleCommentsAtEnd: handlers[3],
      onComment: handlers[4],
      onLike: handlers[5],
      onDislike: handlers[6],
    }) as LooseElement
    const controls = Children.toArray(rail.props.children as ReactNode) as LooseElement[]
    expect(controls.map(control => control.props.icon)).toEqual([
      'feed.mute',
      'feed.share',
      'feed.captions',
      'feed.comments_collapse',
      'feed.comment',
      'feed.like',
      'feed.dislike',
    ])
    controls.forEach((control, index) => {
      expect(control.props.onActivate).toBe(handlers[index])
      ;(control.props.onActivate as () => void)()
      expect(handlers[index]).toHaveBeenCalledOnce()
    })
    expect(controls[0].props['aria-pressed']).toBe(true)
    expect(controls[2].props['aria-pressed']).toBe(false)
    expect(controls[3].props['aria-pressed']).toBe(true)
  })

  it('adds the supplied delete artwork only when an opened Profile post is deletable', () => {
    const sharedProps = {
      side: 'left' as const,
      label: 'Profile post controls',
      muted: true,
      captionsOn: false,
      commentsAtEnd: false,
      onToggleMute: vi.fn(),
      onShare: vi.fn(),
      onToggleCaptions: vi.fn(),
      onToggleCommentsAtEnd: vi.fn(),
      onComment: vi.fn(),
      onLike: vi.fn(),
      onDislike: vi.fn(),
    }
    const withoutDelete = PostActionRail(sharedProps) as LooseElement
    expect(renderToStaticMarkup(withoutDelete)).not.toContain('data-side-control-id="profile.delete"')

    const onDelete = vi.fn()
    const withDelete = PostActionRail({ ...sharedProps, onDelete }) as LooseElement
    const controls = Children.toArray(withDelete.props.children as ReactNode) as LooseElement[]
    const deleteWrapper = controls[controls.length - 1]
    const deleteControl = deleteWrapper.props.children as LooseElement
    expect(deleteControl.type).toBe(SideControlIconButton)
    expect(deleteControl.props.icon).toBe('profile.delete')
    ;(deleteControl.props.onActivate as () => void)()
    expect(onDelete).toHaveBeenCalledOnce()
    expect(renderToStaticMarkup(withDelete)).toContain('aria-label="Delete this post"')

    const profile = readFileSync(new URL('../ProfileTwin.tsx', import.meta.url), 'utf8')
    expect(profile).toMatch(/const canDeleteViewerPost = Boolean\([\s\S]*?!visiting[\s\S]*?mode === 'media'[\s\S]*?uploadedPostsLoaded/)
    expect(profile).toMatch(/onDelete=\{canDeleteViewerPost \?[\s\S]*?setDeletePromptPost\(viewerPost\)/)
    expect(profile).toContain("type: 'deleteProfilePost'")
  })

  it('keeps wrapper handlers for scan, AR, map news, and Conquer', () => {
    const handlers = Array.from({ length: 4 }, () => vi.fn())
    const controls = [
      CameraScanButton({ active: false, onToggle: handlers[0] }),
      CameraARButton({ active: true, onToggle: handlers[1] }),
      MapNewsButton({ active: false, destination: 'edition', onPress: handlers[2] }),
      MapConquerButton({ open: false, onPress: handlers[3] }),
    ] as LooseElement[]
    controls.forEach((control, index) => {
      const handler = control.props.onActivate as () => void
      handler()
      expect(handlers[index]).toHaveBeenCalledOnce()
    })
    expect(playPop).toHaveBeenCalledTimes(2)
  })

  it('keeps the Map News button on Map and opens News only for an explicit story', () => {
    const home = readFileSync(new URL('../HomeTwin.tsx', import.meta.url), 'utf8')
    const map = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')

    // Verified geolocated stories still start the finite camera tour.
    expect(map).toMatch(/<MapNewsButton[\s\S]*?startNewsTour\(\)/)
    expect(home).toMatch(/<MapNewsButton[\s\S]*?sendMapAction\('newsTour'\)/)

    // A failed/empty wire stays on Map and starts the visibly labelled tour
    // preview instead of becoming a no-op. Only a story card's explicit Read
    // action posts the edition handoff with a real event id.
    const startNewsTour = map.slice(
      map.indexOf('const startNewsTour'),
      map.indexOf('// A provider-degraded edition'),
    )
    expect(startNewsTour).not.toContain('openPoplurNewsEdition')
    expect(startNewsTour).toContain('newsTourEventsForSnapshot')
    expect(map).toContain('newsTourRunEventsRef.current = events')
    expect(map).toContain("status: event.preview ? 'top' : event.status")
    const stepNewsTour = map.slice(
      map.indexOf('const stepNewsTour'),
      map.indexOf('const startExplicitTourLoop'),
    )
    expect(stepNewsTour).toContain('const events = newsTourRunEventsRef.current')
    expect(stepNewsTour).toContain('events.length')
    expect(stepNewsTour).not.toContain('newsTourEvents.length')
    expect(map).toContain("? newsTourRunEvents.length\n    : newsTourEvents.length")
    expect(map).toContain('`${newsTourPosition + 1}/${newsTourDisplayCount}`')
    expect(map).toMatch(/onRead=\{\(\) => \{[\s\S]*?openPoplurNewsEdition\(eventId\)/)
    expect(readMapNewsOpenRequest(mapNewsOpenMessage(' live-story ')))
      .toEqual({ eventId: 'live-story' })
    expect(readMapNewsOpenRequest({ type: 'poplur-map-open-news', eventId: '' })).toBeNull()
    expect(readMapNewsOpenRequest({ type: 'poplur-map-open-news' })).toBeNull()
    expect(readMapNewsOpenRequest({ type: 'unrelated' })).toBeNull()
  })

  it('announces Conquer as one required popup disclosure', () => {
    const closed = MapConquerButton({ open: false, onPress: vi.fn() }) as LooseElement
    expect(closed.props['aria-label']).toBe('Show Conquer standings')
    expect(closed.props['aria-expanded']).toBe(false)
    expect(closed.props['aria-controls']).toBe('poplur-conquer-glance')

    const open = MapConquerButton({ open: true, onPress: vi.fn() }) as LooseElement
    expect(open.props['aria-label']).toBe('Hide Conquer standings')
    expect(open.props['aria-expanded']).toBe(true)
    expect(open.props['aria-controls']).toBe('poplur-conquer-glance')
  })

  it('keeps the half-size Conquer popup actionable while standings load', () => {
    const closed = renderToStaticMarkup(createElement(ConquerGlance, {
      snapshot: null,
      open: false,
      onOpen: vi.fn(),
    }))
    expect(closed).toBe('')

    const loading = renderToStaticMarkup(createElement(ConquerGlance, {
      snapshot: null,
      open: true,
      onOpen: vi.fn(),
    }))
    expect(loading).toContain('data-poplur-conquer-glance')
    expect(loading).toContain('data-conquer-preview-version="2"')
    expect(loading).toContain('STANDINGS LOADING')
    expect(loading).toContain('VIEW FULL BOARD')
    expect(loading).toContain('aria-controls="poplur-conquer-board"')
  })

  it('paints the compact Conquer popup as the same white board as the full screen', () => {
    const component = readFileSync(new URL('../ConquerGlance.tsx', import.meta.url), 'utf8')
    const css = readFileSync(new URL('../ConquerGlance.module.css', import.meta.url), 'utf8')
    expect(component).toContain('<span className={styles.board}>')
    expect(component).toContain('<span className={styles.heading}>')
    expect(component).not.toContain('surfaceStyles.surface')
    expect(component).not.toContain('surfaceStyles.header')
    expect(css).toMatch(/\.board\s*\{[\s\S]*?rgba\(255, 247, 252, \.96\)/)
    expect(css).toMatch(/\.heading strong\s*\{[\s\S]*?color: #180913/)
    expect(css).toMatch(/\.heading em\s*\{[\s\S]*?color: #087a99/)
    expect(css).toMatch(/\.row\s*\{[\s\S]*?background: rgba\(255, 255, 255, \.74\)/)
  })

  it('renders a live channel value and preserves both navigation handlers', () => {
    const onUp = vi.fn()
    const onDown = vi.fn()
    const markup = renderToStaticMarkup(PoplurChannelRail({ number: 109, onUp, onDown }))
    expect(markup).toContain('>109<')
    expect(markup).not.toContain('>105<')
    expect(markup).not.toMatch(/class="[^"]*number[^"]*" aria-hidden/)
    expect(markup).not.toContain('data-poplur-channel-arrows')

    const rail = PoplurChannelRail({ number: 109, onUp, onDown }) as LooseElement
    const controls = (Children.toArray(rail.props.children as ReactNode) as LooseElement[])
      .filter(child => typeof child.props?.onClick === 'function')
    expect(controls).toHaveLength(2)
    ;(controls[0].props.onClick as () => void)()
    ;(controls[1].props.onClick as () => void)()
    expect(onUp).toHaveBeenCalledOnce()
    expect(onDown).toHaveBeenCalledOnce()
  })

  it('keeps every shared channel orientation on the common focus/press shell', () => {
    const onUp = vi.fn()
    const onDown = vi.fn()
    const arrows = ClayChannelArrows({
      number: 109,
      orientation: 'horizontal',
      onUp,
      onDown,
    }) as LooseElement
    const controls = (Children.toArray(arrows.props.children as ReactNode) as LooseElement[])
      .filter(child => child.props?.icon === 'global.channel_up' || child.props?.icon === 'global.channel_down')
    expect(controls).toHaveLength(2)
    expect(controls.map(control => control.type)).toEqual([SideControlIconButton, SideControlIconButton])
    expect(controls[0].props.imageStyle).toMatchObject({ transform: 'rotate(-90deg)' })
    expect(controls[0].props.imageSize).toBe(71)
    expect(controls[0].props.style).toMatchObject({ left: 0, width: '44%' })
    expect(controls[1].props.style).toMatchObject({ right: 0, width: '44%' })
    ;(controls[0].props.onActivate as () => void)()
    ;(controls[1].props.onActivate as () => void)()
    expect(onUp).toHaveBeenCalledOnce()
    expect(onDown).toHaveBeenCalledOnce()

    const markup = renderToStaticMarkup(arrows)
    expect(markup).toContain('data-side-control-id="global.channel_up"')
    expect(markup).toContain('data-side-control-id="global.channel_down"')
    expect(markup).toContain('transform:rotate(-90deg)')
  })

  it('uses one responsive scale for the vertical and horizontal channel pairs', () => {
    expect(responsiveChannelControlSize(390)).toBe(144)
    expect(responsiveChannelControlSize(320)).toBe(124)
    expect(responsiveChannelControlSize(900)).toBe(176)
    expect(channelControlImageSize(144)).toBe(58)

    const horizontal = ClayChannelArrows({
      number: 1,
      orientation: 'horizontal',
      size: responsiveChannelControlSize(390),
      onUp: vi.fn(),
      onDown: vi.fn(),
    }) as LooseElement
    const horizontalControls = (Children.toArray(horizontal.props.children as ReactNode) as LooseElement[])
      .filter(child => child.props?.icon === 'global.channel_up' || child.props?.icon === 'global.channel_down')
    expect(horizontalControls[0].props.imageSize).toBe(58)

    const vertical = PoplurChannelRail({
      number: 1,
      size: responsiveChannelControlSize(390),
      onUp: vi.fn(),
      onDown: vi.fn(),
    }) as LooseElement
    const verticalMarkup = renderToStaticMarkup(vertical)
    expect(verticalMarkup).toContain('width="58"')
    expect(verticalMarkup).toContain('height="58"')
  })

  it('keeps the opposite zoom rail on the exact 44px/12px map-control span', () => {
    expect(mapSideControlRailSpan(9)).toBe(492)
    expect(mapSideControlRailSpan(10)).toBe(548)
    expect(mapSideControlRailSpan(11)).toBe(604)
    expect(MAP_COLOR_CONTROL_GAP).toBe(24)
    expect(mapSideControlRailWithColorSpan(9)).toBe(560)
    expect(mapSideControlRailWithColorSpan(10)).toBe(616)

    const clayMap = readFileSync(new URL('../ClayMap.tsx', import.meta.url), 'utf8')
    const clayMapCss = readFileSync(new URL('../ClayMap.module.css', import.meta.url), 'utf8')
    const nativeCss = readFileSync(new URL('../HomeTwin.module.css', import.meta.url), 'utf8')
    expect(clayMap).toContain("'--mapControlSpan': `${mapSideControlSpan}px`")
    expect(clayMap).toContain("'--mapBaseControlSpan': `${mapBaseSideControlSpan}px`")
    expect(clayMap).toContain("'--mapColorControlGap': `${MAP_COLOR_CONTROL_GAP}px`")
    expect(clayMap).toContain('data-poplur-color-side-control=""')
    expect(clayMap).toContain('<SideControlIconImage icon="map.color" displaySize={44} loading="eager" />')
    expect(clayMapCss).not.toContain('conic-gradient(from 90deg at 50% 50%')
    expect(clayMapCss).toMatch(/\.zoomWrap\s*\{[\s\S]*?height:\s*var\(--mapControlSpan, 492px\)/)
    expect(clayMapCss).toMatch(/\.colorCircle\s*\{[\s\S]*?left:\s*max\(12px,[\s\S]*?var\(--mapBaseControlSpan, 492px\)[\s\S]*?var\(--mapColorControlGap, 24px\)[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/)
    expect(nativeCss).toMatch(/\.nativeMapZoom\s*\{[\s\S]*?height:\s*var\(--mapControlSpan, 492px\)/)
  })
})

describe('rail layout and permission-sensitive wiring', () => {
  it('preserves the 44px tap grid and every safe-area inset', () => {
    const css = readFileSync(new URL('../TabControlRail.module.css', import.meta.url), 'utf8')
    expect(css).toContain('grid-auto-rows: 44px')
    expect(css).toContain('min-width: 44px')
    expect(css).toContain('min-height: 44px')
    expect(css).toContain('env(safe-area-inset-top')
    expect(css).toContain('env(safe-area-inset-left')
    expect(css).toContain('env(safe-area-inset-right')
  })

  it('leaves location, camera, live-thumbnail, and library handlers in place', () => {
    const home = readFileSync(new URL('../HomeTwin.tsx', import.meta.url), 'utf8')
    const map = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
    const feed = readFileSync(new URL('../FeedTwin.tsx', import.meta.url), 'utf8')
    const camera = readFileSync(new URL('../Camera.tsx', import.meta.url), 'utf8')
    const profile = readFileSync(new URL('../ProfileTwin.tsx', import.meta.url), 'utf8')
    const news = readFileSync(new URL('../NewsPaper.tsx', import.meta.url), 'utf8')

    expect(home).toMatch(/icon="map\.locate"[\s\S]*?sendMapAction\('locate'\)/)
    expect(map).toMatch(/icon="map\.locate"[\s\S]*?navigator\.geolocation\?\.getCurrentPosition/)
    expect(feed).not.toContain('Not for me')
    expect(feed).toContain('onDislike={dislikeCurrentPost}')
    expect(camera).toMatch(/icon="camera\.flash"[\s\S]*?setFlashEnabled/)
    expect(camera).toMatch(/icon="camera\.mute"[\s\S]*?onActivate=\{toggleAiVoice\}/)
    expect(camera).toMatch(/latestCapture[\s\S]*?libraryNewest[\s\S]*?icon="camera\.camera_roll"/)
    expect(camera).toMatch(/aria-label="Open camera roll"[\s\S]*?onPointerDown=\{event => \{[\s\S]*?event\.isPrimary\) openCameraRoll\(\)[\s\S]*?onClick=\{event => \{[\s\S]*?isKeyboardCameraRollClick\(event\.detail\)\) openCameraRoll\(\)/)
    expect(profile).toMatch(/icon="profile\.alerts"[\s\S]*?icon="profile\.settings"[\s\S]*?icon="profile\.camera"/)
    expect(profile).toContain('onClick={openCapture}')
    expect(news).toMatch(/icon="news\.menu"[\s\S]*?onActivate=\{openMenu\}/)
  })
})
