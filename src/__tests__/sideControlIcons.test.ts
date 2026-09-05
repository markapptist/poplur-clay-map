import { Children, createElement, type ReactElement, type ReactNode } from 'react'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../pop', () => ({ playPop: vi.fn() }))

import CameraARButton from '../CameraARButton'
import CameraScanButton from '../CameraScanButton'
import ClayChannelArrows from '../ClayChannelArrows'
import { clayCornerActivationHandlers } from '../ClayCornerButton'
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
import MapRadioButton from '../MapRadioButton'
import MapRandomTourButton from '../MapRandomTourButton'
import MapRewardRollButton from '../MapRewardRollButton'
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
  weatherIconIdForCode,
  weatherIconIdForCondition,
  weatherIconIdForMode,
  type PoplurSideIconId,
  type PoplurSideIconSize,
} from '../sideControlIcons'

const ALL_IDS = [...SIDE_CONTROL_ICON_IDS, ...WEATHER_ICON_IDS] as const
const SIZES = [256, 512, 1024] as const satisfies readonly PoplurSideIconSize[]

type LooseElement = ReactElement<Record<string, unknown>>

type ButtonFactory = (effect: () => void) => LooseElement

/** Resolve the small, hook-free side-control wrappers down to their real DOM
 * button so the regression exercises the browser event path rather than only
 * calling a wrapper prop directly. */
function materializeButton(element: LooseElement): LooseElement {
  let current = element
  let depth = 0
  while (typeof current.type === 'function') {
    expect(depth++, 'side-control wrappers should remain shallow').toBeLessThan(5)
    const wrapper = current.type as (props: Record<string, unknown>) => ReactElement
    current = wrapper(current.props) as LooseElement
  }
  expect(current.type).toBe('button')
  return current
}

function firePrimaryPointerDown(button: LooseElement) {
  const onPointerDown = button.props.onPointerDown as ((event: { isPrimary: boolean; button: number }) => void) | undefined
  onPointerDown?.({ isPrimary: true, button: 0 })
}

function firePointerClick(button: LooseElement) {
  const onClick = button.props.onClick as ((event: { detail: number }) => void) | undefined
  onClick?.({ detail: 1 })
}

function fireKeyboardClick(button: LooseElement) {
  const onClick = button.props.onClick as ((event: { detail: number }) => void) | undefined
  expect(onClick, 'every side control must preserve keyboard/assistive click activation').toBeTypeOf('function')
  onClick?.({ detail: 0 })
}

function componentSource(name: string) {
  return readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
}

function literalRailSource(source: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const opener = new RegExp(`<TabControlRail\\b[^>]*\\blabel="${escaped}"[^>]*>`).exec(source)
  expect(opener, `${label} rail should be declared`).not.toBeNull()
  const start = opener!.index
  const end = source.indexOf('</TabControlRail>', start)
  expect(end, `${label} rail should close`).toBeGreaterThan(start)
  return source.slice(start, end + '</TabControlRail>'.length)
}

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
  it('contains the exact 46 control IDs and 14 weather IDs from the package', () => {
    expect(SIDE_CONTROL_ICON_IDS).toHaveLength(46)
    expect(WEATHER_ICON_IDS).toHaveLength(14)
    expect(new Set(ALL_IDS).size).toBe(60)
    expect(Object.keys(POPLUR_SIDE_ICONS).sort()).toEqual([...ALL_IDS].sort())
    expect(SIDE_ICON_MANIFEST.buttonCount).toBe(46)
    expect(SIDE_ICON_MANIFEST.weatherConditionCount).toBe(14)
  })

  it('resolves all 180 declared PNGs at their declared dimensions with transparency', () => {
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

  it('preserves WMO cloud detail and classifies rain showers correctly', () => {
    expect(weatherIconIdForCode(0)).toBe('weather.clear_day')
    expect(weatherIconIdForCode(1)).toBe('weather.clear_day')
    expect(weatherIconIdForCode(2)).toBe('weather.partly_cloudy')
    expect(weatherIconIdForCode(3)).toBe('weather.overcast')
    expect(weatherIconIdForCode(2)).not.toBe(weatherIconIdForCode(3))
    expect(weatherIconIdForCode(45)).toBe('weather.fog')
    expect(weatherIconIdForCode(51)).toBe('weather.rain_showers')
    expect(weatherIconIdForCode(55)).toBe('weather.rain_showers')
    expect(weatherIconIdForCode(61)).toBe('weather.rain_showers')
    expect(weatherIconIdForCode(63)).toBe('weather.heavy_rain')
    expect(weatherIconIdForCode(65)).toBe('weather.heavy_rain')
    expect(weatherIconIdForCode(80)).toBe('weather.rain_showers')
    expect(weatherIconIdForCode(81)).toBe('weather.rain_showers')
    expect(weatherIconIdForCode(82)).toBe('weather.heavy_rain')
    expect(weatherIconIdForCode(85)).toBe('weather.snow')
    expect(weatherIconIdForCode(95)).toBe('weather.thunderstorm')
    expect(weatherIconIdForCode(96)).toBe('weather.hail')
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
    const pointerDown = pointerButton.props.onPointerDown as (event: { isPrimary: boolean; button: number }) => void
    pointerDown({ isPrimary: true, button: 2 })
    expect(pointer).not.toHaveBeenCalled()
    pointerDown({ isPrimary: true, button: 0 })
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

  it('keeps ClayCornerButton touch and keyboard activation single-fire in both shells', () => {
    for (const activateOnClick of [false, true]) {
      const pointerEffect = vi.fn()
      const pointerHandlers = clayCornerActivationHandlers({ activateOnClick, onPress: pointerEffect })
      pointerHandlers.onPointerDown({ isPrimary: false, button: 0 })
      expect(pointerEffect, 'secondary pointers never activate').not.toHaveBeenCalled()
      pointerHandlers.onPointerDown({ isPrimary: true, button: 2 })
      expect(pointerEffect, 'right-button pointers never activate').not.toHaveBeenCalled()
      pointerHandlers.onPointerDown({ isPrimary: true, button: 0 })
      expect(pointerEffect, `primary pointer timing with activateOnClick=${activateOnClick}`)
        .toHaveBeenCalledTimes(activateOnClick ? 0 : 1)
      pointerHandlers.onClick({ detail: 1 })
      expect(pointerEffect, 'the pointer gesture activates exactly once').toHaveBeenCalledOnce()

      const keyboardEffect = vi.fn()
      const keyboardHandlers = clayCornerActivationHandlers({ activateOnClick, onPress: keyboardEffect })
      keyboardHandlers.onClick({ detail: 0 })
      expect(keyboardEffect, 'keyboard/assistive click activates exactly once').toHaveBeenCalledOnce()
    }

    const source = componentSource('ClayCornerButton.tsx')
    expect(source.match(/onPointerDown=\{activationHandlers\.onPointerDown\}/g)).toHaveLength(2)
    expect(source.match(/onClick=\{activationHandlers\.onClick\}/g)).toHaveLength(2)
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

  it('keeps every Feed callback attached to its original semantic slot', () => {
    const handlers = Array.from({ length: 6 }, () => vi.fn())
    const rail = PostActionRail({
      side: 'left',
      label: 'Feed controls',
      muted: true,
      captionsOn: false,
      commentsOpen: true,
      onToggleMute: handlers[0],
      onShare: handlers[1],
      onToggleCaptions: handlers[2],
      onComment: handlers[3],
      onLike: handlers[4],
      onDislike: handlers[5],
    }) as LooseElement
    const controls = Children.toArray(rail.props.children as ReactNode) as LooseElement[]
    expect(controls.map(control => control.props.icon)).toEqual([
      'feed.mute',
      'feed.share',
      'feed.captions',
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
    // The one comments button reports whether the window is up.
    expect(controls[3].props['aria-pressed']).toBe(true)
  })

  it('keeps the Feed rail visible but disables post-only actions without a post', () => {
    const handlers = Array.from({ length: 6 }, () => vi.fn())
    const rail = PostActionRail({
      side: 'left',
      label: 'Feed controls',
      muted: false,
      captionsOn: false,
      commentsOpen: false,
      postActionsAvailable: false,
      onToggleMute: handlers[0],
      onShare: handlers[1],
      onToggleCaptions: handlers[2],
      onComment: handlers[3],
      onLike: handlers[4],
      onDislike: handlers[5],
    }) as LooseElement
    const controls = Children.toArray(rail.props.children as ReactNode) as LooseElement[]

    expect(controls).toHaveLength(6)
    // mute, share, captions, comments, like, dislike — the comments control is
    // now post-gated too, since the window it opens belongs to a post.
    expect(controls.map(control => Boolean(control.props.disabled))).toEqual([
      false,
      true,
      false,
      true,
      true,
      true,
    ])
    expect(renderToStaticMarkup(rail)).toContain('aria-label="Feed controls"')
    expect(renderToStaticMarkup(rail).match(/disabled=""/g)).toHaveLength(4)
    for (const index of [1, 3, 4, 5]) {
      const button = materializeButton(controls[index])
      firePrimaryPointerDown(button)
      firePointerClick(button)
      fireKeyboardClick(button)
      expect(handlers[index], `${String(controls[index].props.icon)} stays inert without a post`)
        .not.toHaveBeenCalled()
    }
  })

  it('adds the supplied delete artwork only when an opened Profile post is deletable', () => {
    const sharedProps = {
      side: 'left' as const,
      label: 'Profile post controls',
      muted: true,
      captionsOn: false,
      commentsOpen: false,
      onToggleMute: vi.fn(),
      onShare: vi.fn(),
      onToggleCaptions: vi.fn(),
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

  it('activates every wrapped side command once by touch and once by keyboard', () => {
    const cases: Array<{ label: string; immediate: boolean; create: ButtonFactory }> = [
      {
        label: 'Map radio',
        immediate: true,
        create: effect => MapRadioButton({ active: false, onPress: effect }) as LooseElement,
      },
      {
        label: 'Map random-tour dice',
        immediate: true,
        create: effect => MapRandomTourButton({ onPress: effect }) as LooseElement,
      },
      {
        label: 'Map reward dice',
        immediate: true,
        create: effect => MapRewardRollButton({ active: false, onPress: effect }) as LooseElement,
      },
      {
        label: 'Map News',
        immediate: true,
        create: effect => MapNewsButton({ active: false, onPress: effect }) as LooseElement,
      },
      {
        label: 'Map Conquer',
        immediate: true,
        create: effect => MapConquerButton({ open: false, onPress: effect }) as LooseElement,
      },
      {
        label: 'Camera scan',
        immediate: false,
        create: effect => CameraScanButton({ active: false, onToggle: effect }) as LooseElement,
      },
      {
        label: 'Camera AR',
        immediate: false,
        create: effect => CameraARButton({ active: false, onToggle: effect }) as LooseElement,
      },
    ]

    for (const { label, immediate, create } of cases) {
      const touchEffect = vi.fn()
      const touchButton = materializeButton(create(touchEffect))
      firePrimaryPointerDown(touchButton)
      expect(touchEffect, `${label} primary pointer-down timing`).toHaveBeenCalledTimes(immediate ? 1 : 0)
      firePointerClick(touchButton)
      expect(touchEffect, `${label} touch activation`).toHaveBeenCalledOnce()

      const keyboardEffect = vi.fn()
      fireKeyboardClick(materializeButton(create(keyboardEffect)))
      expect(keyboardEffect, `${label} keyboard activation`).toHaveBeenCalledOnce()
    }
  })

  it('keeps the Map News button on Map and opens News only for an explicit story', () => {
    const home = readFileSync(new URL('../HomeTwin.tsx', import.meta.url), 'utf8')
    const map = readFileSync(new URL('../MapApp.tsx', import.meta.url), 'utf8')

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
    vi.mocked(playPop).mockClear()
    ;(controls[0].props.onClick as () => void)()
    ;(controls[1].props.onClick as () => void)()
    expect(onUp).toHaveBeenCalledOnce()
    expect(onDown).toHaveBeenCalledOnce()
    expect(playPop).not.toHaveBeenCalled()

    const home = componentSource('HomeTwin.tsx')
    const channelOwner = home.slice(home.indexOf('const changeChannel'), home.indexOf('useEffect(() => {', home.indexOf('const changeChannel')))
    expect(channelOwner).toContain('playPop()')
    expect(channelOwner).toContain('claimCubeNavigationSound()')
    expect(channelOwner.indexOf('profileArrowsRef.current')).toBeLessThan(channelOwner.indexOf('pushScreen(dir)'))
    expect(channelOwner.indexOf('subscreenArrowsRef.current')).toBeLessThan(channelOwner.indexOf('pushScreen(dir)'))
    expect(home).toContain('navigationSoundClaimed: cubeNavigationSoundClaimRef.current.claimed()')

    const holdMenu = componentSource('HoldMenuTwin.tsx')
    const pageWalker = holdMenu.slice(holdMenu.indexOf('bindArrows((dir:'), holdMenu.indexOf('return () => bindArrows(null)'))
    expect(pageWalker).not.toContain('playPop()')

    const storeRoute = holdMenu.slice(holdMenu.indexOf('function rclSubscreenUrl'), holdMenu.indexOf('// Placeholder for icons'))
    expect(storeRoute.indexOf("if (!item.preview)")).toBeLessThan(storeRoute.indexOf('const localHost'))
    // STORE must resolve through the pack seam: the build drops
    // public/subscreens/ whenever the manifest names a published base, so a
    // same-origin `./subscreens/...` src 404s on device (blank white STORE —
    // this exact regression shipped on 2026-09-01). packBase still hands back
    // the bundled path in fully-local mode, so local-only builds keep working.
    expect(storeRoute).toContain("packBase('subscreens', 'subscreens')")
    expect(storeRoute).toContain('subscreensPackRev()')
    expect(storeRoute).not.toContain("'./subscreens/index.html")
    expect(holdMenu).toContain("data.type === 'poplurSubscreenReady'")
    expect(holdMenu).toContain('if (activeScreen.preview) setEmbedLoaded(true)')
    const subscreenRuntime = readFileSync(
      new URL('../../public/subscreens/poplur-subscreen-twins.js', import.meta.url),
      'utf8',
    )
    expect(subscreenRuntime).toContain("window.parent.postMessage({ type: 'poplurSubscreenReady' }, '*')")
  })

  it('assigns one sound owner to nested cube-model navigation', () => {
    const home = componentSource('HomeTwin.tsx')
    const hold = componentSource('HoldMenuTwin.tsx')
    const phone = componentSource('PhoneScreen.tsx')
    const mail = componentSource('MailScreen.tsx')
    const avatar = componentSource('AvatarScreen.tsx')
    const settings = componentSource('SettingsScreen.tsx')
    const ipod = componentSource('MapIpod.tsx')
    const studio = componentSource('StudioScreen.tsx')
    const profile = componentSource('ProfileTwin.tsx')
    const composer = componentSource('PostComposer.tsx')

    expect(home).toContain('cancelCubeScreenNavigationSoundRef.current()')
    expect(home).toContain('if (!surfaceVisible) cancelCubeScreenNavigationSound()')
    expect(home).toMatch(/const acceptIncomingCall[\s\S]*?playCubeNavigationPop\(\)/)
    expect(home).toMatch(/const declineIncomingCall[\s\S]*?playCubeNavigationPop\(\)/)
    expect(home).toMatch(/composerOpen && cameraActionsRef\.current\?\.composerBack\(\)[\s\S]*?playPop\(\)[\s\S]*?beginCubeScreenNavigationSound\(\)[\s\S]*?return/)
    expect(hold).toMatch(/const playSubscreenNavigationPop[\s\S]*?markCubeNavigationPop\(\)/)
    expect(hold).toContain('playSubscreenNavigationPop(false)')
    const delegatedAction = hold.slice(hold.indexOf('if (item.action)'), hold.indexOf('// CREATE opens'))
    expect(delegatedAction).not.toContain('playPop(')
    expect(delegatedAction).toMatch(/item\.action === 'profile'[\s\S]*?markCubeNavigationPop\(\)[\s\S]*?else[\s\S]*?playSubscreenNavigationPop\(false\)/)
    const feed = componentSource('FeedTwin.tsx')
    expect(feed).toMatch(/if \(action === 'profile'\)[\s\S]*?const current = postRef\.current[\s\S]*?if \(!current\) \{ playPop\(\); return \}[\s\S]*?playCubeNavigationPop\(\)[\s\S]*?onOpenProfile/)
    expect(hold).toMatch(/activeScreen\?\.screen === 'feed-tvguide'[\s\S]*?onCloseRef\.current\('dismiss'\)/)
    expect(phone).toMatch(/if \(incomingCall\)[\s\S]*?if \(key === '5'\) onAcceptCall/)
    expect(phone).not.toMatch(/if \(key === '5'\) \{ playPop\(\); onAcceptCall/)
    expect(mail).toMatch(/const endAndReturnToChat[\s\S]*?playCubeNavigationPop\(\)/)
    expect(avatar).toMatch(/const takeOff[\s\S]*?playPop\(\)[\s\S]*?wearAvatarCube\(null\)/)
    expect(avatar).toMatch(/const remove[\s\S]*?playPop\(\)[\s\S]*?deleteAvatarCube/)
    expect(settings).toMatch(/settingsCubeFace\(page\) !== settingsCubeFace\(next\)[\s\S]*?playCubeNavigationPop\(\)/)
    expect(ipod).toMatch(/row\.go\?\.id === 'podcasts'\) playCubeNavigationPop\(\)[\s\S]*?else playPop\(\)/)
    const phoneColorway = phone.slice(phone.indexOf('const cycleColorway'), phone.indexOf('const step =', phone.indexOf('const cycleColorway')))
    expect(phoneColorway).not.toContain('playPop(')
    const ipodFinish = ipod.slice(ipod.indexOf('const stepFinish'), ipod.indexOf('const pct', ipod.indexOf('const stepFinish')))
    expect(ipodFinish).not.toContain('playPop(')
    expect(hold).toMatch(/initialSection="podcasts"[\s\S]*?onClose=\{\(\) => \{[\s\S]*?playPop\(\)[\s\S]*?closePodcastIpod\(\)/)
    const podcastOverlayClose = hold.slice(hold.indexOf('initialSection="podcasts"'), hold.indexOf('/>', hold.indexOf('initialSection="podcasts"')))
    expect(podcastOverlayClose).not.toContain('playSubscreenNavigationPop')
    expect(podcastOverlayClose).not.toContain('markCubeNavigationPop')
    const studioLibrary = hold.slice(hold.indexOf('onOpenLibrary={(section)'), hold.indexOf('/>', hold.indexOf('onOpenLibrary={(section)')))
    const podcastLibrary = studioLibrary.slice(studioLibrary.indexOf("if (section === 'podcasts')"), studioLibrary.indexOf('// Music'))
    expect(podcastLibrary).not.toContain('subscreenNavigationPopRef.current = true')
    expect(studioLibrary.slice(studioLibrary.indexOf('// Music'))).toContain('subscreenNavigationPopRef.current = true')
    expect(studio).toMatch(/recording && mode === 'music'\) playCubeNavigationPop\(\)[\s\S]*?else playPop\(\)/)
    expect(studio).toMatch(/const uploadTrack[\s\S]*?if \(!file\) return[\s\S]*?playCubeNavigationPop\(\)/)
    expect(profile).toMatch(/const beginCapture[\s\S]*?playCubeNavigationPop\(\)/)
    const profileArrowOwner = profile.slice(profile.indexOf('bindArrows(dir =>'), profile.indexOf('return () => bindArrows(null)', profile.indexOf('bindArrows(dir =>')))
    expect(profileArrowOwner).not.toContain('playPop(')
    const composerArrowOwner = composer.slice(composer.indexOf('bindArrows((dir:'), composer.indexOf('return () => bindArrows(null)', composer.indexOf('bindArrows((dir:')))
    expect(composerArrowOwner).not.toContain('playPop(')
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

  it('keeps the embedded left/right pair at half the former cube gap', () => {
    const css = readFileSync(new URL('../App.module.css', import.meta.url), 'utf8')
    const embeddedStepper = css.slice(
      css.indexOf('.popStepperAboveCube'),
      css.indexOf('.popStepperNewsHidden'),
    )

    expect(embeddedStepper).toContain(
      '--shell-control-gap: clamp(4px, calc((100vw - 480px) / 5), 220px);',
    )
    expect(embeddedStepper).toContain(
      'bottom: calc(18px + var(--shell-cube-size) + var(--shell-control-gap));',
    )
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
    const globalCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
    expect(clayMap).toContain("'--mapControlSpan': `${mapSideControlSpan}px`")
    expect(clayMap).toContain("'--mapBaseControlSpan': `${mapBaseSideControlSpan}px`")
    expect(clayMap).toContain("'--mapColorControlGap': `${MAP_COLOR_CONTROL_GAP}px`")
    expect(clayMap).toContain('data-poplur-color-side-control=""')
    expect(clayMap).toContain('<SideControlIconImage icon="map.color" displaySize={44} loading="eager" />')
    expect(clayMapCss).not.toContain('conic-gradient(from 90deg at 50% 50%')
    expect(clayMapCss).toMatch(/\.zoomWrap\s*\{[\s\S]*?height:\s*var\(--mapControlSpan, 492px\)/)
    expect(clayMapCss).toMatch(/\.colorCircle\s*\{[\s\S]*?left:\s*max\(12px,[\s\S]*?var\(--mapBaseControlSpan, 492px\)[\s\S]*?var\(--mapColorControlGap, 24px\)[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/)
    expect(nativeCss).toMatch(/\.nativeMapZoom\s*\{[\s\S]*?height:\s*var\(--mapControlSpan, 492px\)/)
    expect(globalCss).toMatch(/--poplur-map-control-top:\s*max\(154px,\s*calc\(env\(safe-area-inset-top,\s*0px\)\s*\+\s*112px\)\)/)
    expect(globalCss).toMatch(/@media\s*\(max-width:\s*600px\)[\s\S]*?--poplur-map-control-top:\s*max\(62px,\s*calc\(env\(safe-area-inset-top,\s*0px\)\s*\+\s*12px\)\)/)
    expect(nativeCss).toMatch(/\.nativeMapChrome\s+:global\(\[data-poplur-control-rail\]\)\s*\{[\s\S]*?top:\s*var\(--poplur-map-control-top/)
    expect(nativeCss).toMatch(/\.nativeMapZoom\s*\{[\s\S]*?top:\s*var\(--poplur-map-control-top/)
    expect(clayMapCss).toMatch(/\.zoomWrap\s*\{[\s\S]*?top:\s*var\(--poplur-map-control-top/)
    expect(clayMapCss).toMatch(/\.colorCircle\s*\{[\s\S]*?top:\s*calc\(var\(--poplur-map-control-top/)
  })
})

describe('screen side-button action smoke contract', () => {
  const railContracts = [
    {
      file: 'HomeTwin.tsx',
      label: 'Map controls',
      actions: [
        ['mute', /icon="map\.mute"[\s\S]*?setUserMuted\(next\)[\s\S]*?setLoadingMuted\(next\)/],
        ['radio', /<MapRadioButton[\s\S]*?stopMapRadio\(\)[\s\S]*?startRadioForMap/],
        ['daily reward dice', /<MapRewardRollButton[\s\S]*?announceRadiusRewardNavigator\(true\)/],
        ['locate', /icon="map\.locate"[\s\S]*?sendMapAction\('locate'\)/],
        ['search', /icon="map\.search"[\s\S]*?sendMapAction\('search'\)/],
        ['landmark tour', /icon=\{landmarkTourControl\.icon\}[\s\S]*?sendMapAction\(landmarkTourControl\.action\)/],
        ['news tour', /<MapNewsButton[\s\S]*?sendMapAction\('newsTour'\)/],
        ['Conquer', /<MapConquerButton[\s\S]*?setMapConquerGlanceOpen\(open => !open\)/],
        ['layers', /<MapLevelButton[\s\S]*?setMapPopLevel\(level\)[\s\S]*?sendMapAction\('setPopLevel'/],
        ['weather', /data-weather-mode=\{mapWeatherDisplay\.mode\}[\s\S]*?sendMapAction\('weather'\)/],
      ],
    },
    {
      file: 'MapApp.tsx',
      label: 'Map controls',
      actions: [
        ['mute', /icon="map\.mute"[\s\S]*?setUserMuted\(next\)[\s\S]*?setMuted\(next\)/],
        ['radio', /<MapRadioButton[\s\S]*?stopMapRadio\(\)[\s\S]*?startRadioForMap/],
        ['random-tour dice', /<MapRandomTourButton[\s\S]*?startRandomLandmarkTour\(\)/],
        ['locate', /icon="map\.locate"[\s\S]*?__locateMe[\s\S]*?getCurrentPosition/],
        ['search', /icon="map\.search"[\s\S]*?closeSearch\(\)[\s\S]*?openSearch\(\)/],
        ['landmark tour', /icon=\{landmarkTourControl\.icon\}[\s\S]*?startExplicitTourLoop\(0\)[\s\S]*?resumeLandmarkTour\(\)[\s\S]*?pauseLandmarkTour\(\)/],
        ['news tour', /<MapNewsButton[\s\S]*?stopTour\(\)[\s\S]*?startNewsTour\(\)/],
        ['Conquer', /<MapConquerButton[\s\S]*?setMapConquerGlanceOpen\(open => !open\)/],
        ['layers', /<MapLevelButton[\s\S]*?onPick=\{setPopLevel\}/],
        ['weather', /data-weather-mode=\{weatherMode\}[\s\S]*?toggleWeather\(\)/],
      ],
    },
    {
      file: 'Camera.tsx',
      label: 'Camera controls',
      actions: [
        ['flash', /icon="camera\.flash"[\s\S]*?setFlashEnabled\(!flashRef\.current\)/],
        ['voice', /icon="camera\.mute"[\s\S]*?onActivate=\{toggleAiVoice\}/],
        ['flip', /icon="camera\.flip_camera"[\s\S]*?onActivate=\{flipCamera\}/],
        ['scan', /<CameraScanButton[\s\S]*?setDetectOn\(!detectOn\)/],
        ['AR filters', /<CameraARButton[\s\S]*?setArOpen\(open => !open\)/],
        ['camera roll', /aria-label="Open camera roll"[\s\S]*?event\.isPrimary\) openCameraRoll\(\)[\s\S]*?isKeyboardCameraRollClick\(event\.detail\)\) openCameraRoll\(\)/],
      ],
    },
    {
      file: 'NewsPaper.tsx',
      label: 'News controls',
      actions: [
        ['menu', /icon="news\.menu"[\s\S]*?onActivate=\{openMenu\}/],
        ['back to top', /aria-label="Back to the top of the paper"[\s\S]*?onClick=\{backToTop\}|onClick=\{backToTop\}[\s\S]*?aria-label="Back to the top of the paper"/],
      ],
    },
    {
      file: 'ProfileTwin.tsx',
      label: 'Profile selfie controls',
      actions: [
        ['AR filters', /<CameraARButton[\s\S]*?setSelfieArOpen\(open => !open\)/],
        ['flip camera', /icon="camera\.flip_camera"[\s\S]*?setFacingMode\(mode => mode === 'user'/],
        ['camera roll', /icon="camera\.camera_roll"[\s\S]*?onActivate=\{openProfileCameraRoll\}/],
        ['return to camera', /icon="profile\.camera"[\s\S]*?onActivate=\{returnToProfileCamera\}/],
      ],
    },
    {
      file: 'ProfileTwin.tsx',
      label: 'Profile controls',
      actions: [
        ['notifications', /icon="profile\.alerts"[\s\S]*?toggleNotifs\(\)|toggleNotifs\(\)[\s\S]*?icon="profile\.alerts"/],
        ['settings', /icon="profile\.settings"[\s\S]*?poplur-open-settings|poplur-open-settings[\s\S]*?icon="profile\.settings"/],
        ['message visitor', /kind="mail"[\s\S]*?setMailingUser\(true\)/],
        ['capture profile', /icon="profile\.camera"[\s\S]*?onClick=\{openCapture\}|onClick=\{openCapture\}[\s\S]*?icon="profile\.camera"/],
      ],
    },
    {
      file: 'PostActionRail.tsx',
      label: null,
      actions: [
        ['mute', /icon="feed\.mute"[\s\S]*?onActivate=\{onToggleMute\}/],
        ['share', /icon="feed\.share"[\s\S]*?onActivate=\{onShare\}/],
        ['captions', /icon="feed\.captions"[\s\S]*?onActivate=\{onToggleCaptions\}/],
        ['comment', /icon="feed\.comment"[\s\S]*?onActivate=\{onComment\}/],
        ['like', /icon="feed\.like"[\s\S]*?onActivate=\{onLike\}/],
        ['dislike', /icon="feed\.dislike"[\s\S]*?onActivate=\{onDislike\}/],
        ['delete owned post', /icon="profile\.delete"[\s\S]*?onDelete\(\)/],
      ],
    },
  ] satisfies Array<{
    file: string
    label: string | null
    actions: Array<readonly [name: string, wiring: RegExp]>
  }>

  it('keeps the contract inventory in lockstep with every declared side rail', () => {
    const discovered: string[] = []
    const sourceDirectory = new URL('../', import.meta.url)
    for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.tsx')) continue
      const source = componentSource(entry.name)
      for (const match of source.matchAll(/<TabControlRail\b[^>]*\blabel=(?:"([^"]+)"|\{([^}]+)\})[^>]*>/g)) {
        discovered.push(`${entry.name}::${match[1] ?? match[2]}`)
      }
    }

    const declared = railContracts.map(contract => (
      `${contract.file}::${contract.label ?? 'label'}`
    ))
    expect(discovered.sort()).toEqual(declared.sort())
  })

  it('wires every declared rail action to a screen command or state edge', () => {
    for (const contract of railContracts) {
      const source = componentSource(contract.file)
      const rail = contract.label == null ? source : literalRailSource(source, contract.label)
      for (const [name, wiring] of contract.actions) {
        expect(rail, `${contract.file} ${name} should have an observable action`).toMatch(wiring)
      }
    }
  })

  it('marks every immediate rail action for primary pointer-down activation', () => {
    const immediate = [
      ['HomeTwin.tsx', 'Map controls', /icon="map\.mute"[\s\S]*?activation="pointerdown"/],
      ['MapApp.tsx', 'Map controls', /icon="map\.mute"[\s\S]*?activation="pointerdown"/],
      ['Camera.tsx', 'Camera controls', /icon="camera\.flash"[\s\S]*?activation="pointerdown"/],
      ['Camera.tsx', 'Camera controls', /icon="camera\.mute"[\s\S]*?activation="pointerdown"/],
      ['Camera.tsx', 'Camera controls', /icon="camera\.flip_camera"[\s\S]*?activation="pointerdown"/],
      ['ProfileTwin.tsx', 'Profile selfie controls', /icon="camera\.flip_camera"[\s\S]*?activation="pointerdown"/],
      ['ProfileTwin.tsx', 'Profile selfie controls', /icon="camera\.camera_roll"[\s\S]*?activation="pointerdown"/],
      ['ProfileTwin.tsx', 'Profile selfie controls', /icon="profile\.camera"[\s\S]*?activation="pointerdown"/],
      ['PostActionRail.tsx', null, /icon="feed\.mute"[\s\S]*?activation="pointerdown"/],
      ['PostActionRail.tsx', null, /icon="feed\.share"[\s\S]*?activation="pointerdown"/],
      ['PostActionRail.tsx', null, /icon="feed\.comment"[\s\S]*?activation="pointerdown"/],
      ['PostActionRail.tsx', null, /icon="feed\.like"[\s\S]*?activation="pointerdown"/],
      ['PostActionRail.tsx', null, /icon="feed\.dislike"[\s\S]*?activation="pointerdown"/],
    ] as const

    for (const [file, label, declaration] of immediate) {
      const source = componentSource(file)
      const rail = label == null ? source : literalRailSource(source, label)
      expect(rail, `${file} immediate action should fire before the synthetic click`).toMatch(declaration)
    }
  })

  it('keeps named callbacks behind rail controls connected to observable work', () => {
    const effects = [
      ['Camera voice', 'Camera.tsx', /const toggleAiVoice[\s\S]*?writeCameraAiVoice\(next\)[\s\S]*?setAiVoice\(next\)[\s\S]*?postNativeEvent/],
      ['Camera flip', 'Camera.tsx', /const flipCamera[\s\S]*?setFacing\([\s\S]*?postNativeEvent\(\{ type: 'cameraControl', control: 'flip'/],
      ['Camera roll', 'Camera.tsx', /const openCameraRoll[\s\S]*?playPop\(\)[\s\S]*?onOpenRoll\?\.\(\)/],
      ['News menu', 'NewsPaper.tsx', /const openMenu[\s\S]*?setMenuMounted\(true\)[\s\S]*?setMenuOpen\(true\)/],
      ['News top', 'NewsPaper.tsx', /const backToTop[\s\S]*?scrollTo\(\{ top: 0, behavior: 'smooth' \}\)/],
      ['Profile notifications', 'ProfileTwin.tsx', /const toggleNotifs[\s\S]*?poplur-open-notifications[\s\S]*?openNotifs\(\)/],
      ['Profile capture', 'ProfileTwin.tsx', /const openCapture[\s\S]*?setFaceAsk\(true\)[\s\S]*?beginCapture\(\)/],
    ] as const
    for (const [name, file, effect] of effects) {
      expect(componentSource(file), `${name} should change UI or cross a bridge`).toMatch(effect)
    }
  })

  it('keeps both shared post-rail consumers connected to real screen effects', () => {
    const consumers = [
      {
        screen: 'Feed',
        file: 'FeedTwin.tsx',
        wiring: [
          /onToggleMute=\{toggleMute\}/,
          /onShare=\{sharePost\}/,
          /onToggleCaptions=\{toggleCaptions\}/,
          /onComment=\{toggleComments\}/,
          /onLike=\{likeCurrentPost\}/,
          /onDislike=\{dislikeCurrentPost\}/,
        ],
        effects: [
          /const toggleMute[\s\S]*?setUserMuted\(next\)[\s\S]*?setMuted\(next\)/,
          /const sharePost[\s\S]*?postNativeEvent[\s\S]*?navigator\.clipboard\.writeText/,
          /const toggleCaptions[\s\S]*?setCaptionsOn\(on => !on\)/,
          /const toggleCommentsAtEnd[\s\S]*?setCommentsAtEnd\(next\)/,
          /const openComments[\s\S]*?setCommentOpen\(true\)/,
          /const reactToCurrentPost[\s\S]*?recordPostEngagement[\s\S]*?setRadiusReaction/,
        ],
      },
      {
        screen: 'Profile post viewer',
        file: 'ProfileTwin.tsx',
        wiring: [
          /onToggleMute=\{toggleViewerMute\}/,
          /onShare=\{\(\) => \{ playPop\(\); setShareOpen\(true\) \}\}/,
          /onToggleCaptions=\{\(\) => \{ playPop\(\); setViewerCaptionsOn/,
          /onComment=\{\(\) => \{ playPop\(\); setViewerCommentOpen\(open => !open\) \}\}/,
          /onLike=\{\(\) => reactToViewerPost\('up'\)\}/,
          /onDislike=\{\(\) => reactToViewerPost\('down'\)\}/,
          /onDelete=\{canDeleteViewerPost[\s\S]*?setDeletePromptPost\(viewerPost\)/,
        ],
        effects: [
          /const toggleViewerMute[\s\S]*?setViewerMuted\(next\)/,
          /const toggleViewerCommentsAtEnd[\s\S]*?setViewerCommentsAtEnd\(next\)/,
          /const reactToViewerPost[\s\S]*?recordPostEngagement[\s\S]*?flashNote/,
        ],
      },
    ]

    for (const consumer of consumers) {
      const source = componentSource(consumer.file)
      for (const wiring of consumer.wiring) {
        expect(source, `${consumer.screen} should supply every shared rail callback`).toMatch(wiring)
      }
      for (const effect of consumer.effects) {
        expect(source, `${consumer.screen} callbacks should do observable work`).toMatch(effect)
      }
    }
  })

  it('keeps standalone side controls on media, phone, iPod, Studio, and dialogs actionable', () => {
    const contracts = [
      ['TV Guide volume', 'TVGuide.tsx', /icon="media\.volume"[\s\S]*?setUserMuted\(next\)[\s\S]*?setMuted\(next\)/],
      ['Radio volume', 'RadioScreen.tsx', /icon="media\.volume"[\s\S]*?setUserMuted\(next\)[\s\S]*?setMuted\(next\)/],
      ['Radio previous', 'RadioScreen.tsx', /kind="seekBack"[\s\S]*?scan\(-1\)/],
      ['Radio favourite', 'RadioScreen.tsx', /kind="heart"[\s\S]*?toggleFav\(tuned\.id\)/],
      ['Radio play', 'RadioScreen.tsx', /kind="play"[\s\S]*?tune\(tuned\)/],
      ['Radio share', 'RadioScreen.tsx', /kind="share"[\s\S]*?playPop\(\)/],
      ['Radio next', 'RadioScreen.tsx', /kind="seekFwd"[\s\S]*?scan\(1\)/],
      ['Phone previous colorway', 'PhoneScreen.tsx', /upLabel="Previous phone colorway"[\s\S]*?onUp=\{\(\) => cycleColorway\(-1\)\}|onUp=\{\(\) => cycleColorway\(-1\)\}[\s\S]*?upLabel="Previous phone colorway"/],
      ['Phone next colorway', 'PhoneScreen.tsx', /downLabel="Next phone colorway"[\s\S]*?onDown=\{\(\) => cycleColorway\(1\)\}|onDown=\{\(\) => cycleColorway\(1\)\}[\s\S]*?downLabel="Next phone colorway"/],
      ['iPod previous finish', 'MapIpod.tsx', /upLabel="Previous finish"[\s\S]*?onUp=\{\(\) => stepFinish\(-1\)\}/],
      ['iPod next finish', 'MapIpod.tsx', /downLabel="Next finish"[\s\S]*?onDown=\{\(\) => stepFinish\(1\)\}/],
      ['Studio library', 'StudioScreen.tsx', /aria-label="Open My Tracks in iPod"[\s\S]*?onOpenLibrary\('root'\)/],
      ['Feed fullscreen pause', 'FeedTwin.tsx', /icon="media\.pause"[\s\S]*?onActivate=\{togglePlayback\}/],
      ['Feed comment send', 'FeedTwin.tsx', /kind="send"[\s\S]*?onPress=\{sendComment\}/],
      ['Profile visitor message', 'ProfileTwin.tsx', /kind="mail"[\s\S]*?setMailingUser\(true\)/],
      ['Profile copy link', 'ProfileTwin.tsx', /kind="link"[\s\S]*?onPress=\{copyLink\}/],
      ['Profile share out', 'ProfileTwin.tsx', /kind="share"[\s\S]*?onPress=\{shareOutside\}/],
      ['Profile share cancel', 'ProfileTwin.tsx', /kind="close"[\s\S]*?setShareOpen\(false\)/],
      ['Profile message send', 'ProfileTwin.tsx', /type: 'sendDM'[\s\S]*?const sendProfileMessage[\s\S]*?kind="send"[\s\S]*?activateOnClick[\s\S]*?onPress=\{sendProfileMessage\}/],
    ] as const

    for (const [name, file, action] of contracts) {
      expect(componentSource(file), `${name} should retain its observable effect`).toMatch(action)
    }

    const declaredClayControls = contracts.filter(([, , pattern]) => (
      pattern.source.includes('kind=')
    )).length
    const discoveredClayControls = readdirSync(new URL('../', import.meta.url), { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.tsx'))
      .reduce((count, entry) => (
        count + [...componentSource(entry.name).matchAll(/<ClayCornerButton\b/g)].length
      ), 0)
    expect(discoveredClayControls).toBe(declaredClayControls)
  })
})

describe('Map takeover colour synchronization', () => {
  it('uses one selected palette for the live pin, owned posts, zoom rail, and conquered land', () => {
    const clayMap = readFileSync(new URL('../ClayMap.tsx', import.meta.url), 'utf8')
    const mapApp = readFileSync(new URL('../MapApp.tsx', import.meta.url), 'utf8')

    expect(clayMap).toContain("pinWithFace({ avatar: null, color: takeoverFace, mode: '3d' })")
    expect(clayMap).not.toContain("pinWithFace({ avatar: null, color: takeoverTint('#E04791'), mode: '3d' })")
    expect(clayMap).toMatch(/ownProfileSelfieVideo, takeoverFace\]\)/)
    expect(clayMap).toMatch(/'--zoomFillA': takeoverTint\('#ffe1f1'\)[\s\S]*?'--zoomFillB': takeoverTint\('#ff86c4'\)[\s\S]*?'--zoomFillC': takeoverTint\('#f53c99'\)/)
    expect(clayMap).toContain('applyClaimsPalette(map)')
    expect(clayMap).toContain('setTakeoverColor(swatch.color)')
    expect(mapApp).toContain('color: pin.mine ? myColor : pin.color')
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
    const map = readFileSync(new URL('../MapApp.tsx', import.meta.url), 'utf8')
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
