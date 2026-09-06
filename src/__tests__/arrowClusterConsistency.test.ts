import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (name: string) => readFileSync(resolve(process.cwd(), 'src', name), 'utf8')
const cluster = read('ClayArrowCluster.tsx')
const clusterCss = read('ClayArrowCluster.module.css')
const mapApp = read('MapApp.tsx')
const clayMap = read('ClayMap.tsx')
const camera = read('Camera.tsx')
const feed = read('FeedTwin.tsx')

describe('one arrow cluster, one place, three screens', () => {
  it('is the same component on the map, the camera and the feed', () => {
    for (const [name, source] of [['MapApp', mapApp], ['Camera', camera], ['FeedTwin', feed]] as const) {
      expect(source, `${name} should render the shared cluster`).toContain('<ClayArrowCluster')
      expect(source, `${name} should import it`).toContain("from './ClayArrowCluster'")
    }
  })

  it('docks in one place, from one stylesheet', () => {
    // Every screen inherits the position — none of them may re-place the
    // arrows, which is the whole point of the change.
    expect(clusterCss).toContain('bottom: calc(18px + var(--shell-cube-size) + var(--shell-control-gap));')
    expect(clusterCss).toContain('left: 50%')
    expect(clusterCss).toContain('transform: translateX(-50%)')
  })

  it('draws four arrows from the two authored pieces of art', () => {
    // Left and right are up and down turned on their side — the same sprites,
    // rotated, so all four arrows match in weight and lighting.
    expect(cluster).toContain("up: 'global.channel_up'")
    expect(cluster).toContain("down: 'global.channel_down'")
    expect(cluster).toContain("left: 'global.channel_up'")
    expect(cluster).toContain("right: 'global.channel_down'")
    expect(clusterCss).toContain('rotate(-90deg)')
  })

  it('gives the map back the rail height the zoom button was holding', () => {
    // The travel button is the cluster's up arrow now. Nothing else shares the
    // zoom column, so the slider runs its full length.
    expect(clayMap).not.toContain('styles.zoomTravel')
    expect(clayMap).toContain("const travelCamera = useCallback((direction: 'in' | 'out')")
    expect(clayMap).toContain('holder.__poplurZoomTravel = travelCamera')
    expect(mapApp).toContain("live?.__poplurZoomTravel?.(direction)")
  })

  it('keeps the camera lens rocker: a tap steps, a hold keeps going', () => {
    expect(cluster).toContain('onHorizontalHold')
    expect(camera).toContain('onHorizontalHold={direction => {')
    expect(camera).toContain('holdDelayMs={ZOOM_HOLD_DELAY_MS}')
    // A hold that outlives its screen must release the ramp, or the lens keeps
    // travelling after the arrows are gone.
    expect(cluster).toContain('useEffect(() => () => {')
  })

  it('leaves one column of buttons per screen', () => {
    // The loose controls that used to ride on the shoulder of the picker
    // opposite now live in each screen's own rail; the pickers are only
    // pickers.
    expect(camera).not.toMatch(/<CameraARRail[\s\S]{0,400}head=\{/)
    expect(feed).not.toMatch(/<FeedChannelRail[\s\S]{0,400}head=\{/)
    expect(feed).toMatch(/<PostActionRail[\s\S]{0,600}head=\{post \?/)
  })

  it('does not leave the replaced steppers behind to be edited by mistake', () => {
    for (const source of [camera, feed]) {
      expect(source).not.toContain('CameraStepControls')
      expect(source).not.toContain('FeedChannelStep')
    }
  })
})
