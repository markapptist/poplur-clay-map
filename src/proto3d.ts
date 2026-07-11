// Comparison page (/3d.html): Google Photorealistic 3D Tiles — real photo
// textures on every building, the look Mapbox cannot produce. Standalone;
// the production clay map is untouched. Cesium comes from the CDN script tag.

declare const Cesium: any

const key = import.meta.env.VITE_GOOGLE_TILES_KEY as string | undefined

async function main() {
  const el = document.getElementById('cesium')!
  if (!key) {
    el.innerHTML =
      '<p style="color:#ff5cab;font:600 15px system-ui;padding:24px">' +
      'Missing VITE_GOOGLE_TILES_KEY in .env — restart the dev server after adding it.</p>'
    return
  }

  const viewer = new Cesium.Viewer('cesium', {
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    // No 2D imagery underlay — the 3D tiles carry the whole scene.
    baseLayer: false,
    requestRenderMode: false,
  })
  viewer.scene.globe.show = false
  viewer.scene.skyAtmosphere.show = true

  // Google Photorealistic 3D Tiles (attribution renders on-screen as required).
  const tileset = await Cesium.Cesium3DTileset.fromUrl(
    `https://tile.googleapis.com/v1/3dtiles/root.json?key=${key}`,
    { showCreditsOnScreen: true },
  )
  viewer.scene.primitives.add(tileset)
  ;(window as unknown as { __protoViewer?: unknown }).__protoViewer = viewer

  // Camera policy: locked to the hybrid flyover perspective. Pan, rotate and
  // zoom are free; tilting away from the fixed pitch is not, and zoom stays
  // inside the street-to-district envelope.
  const ctrl = viewer.scene.screenSpaceCameraController
  ctrl.enableTilt = false
  ctrl.enableLook = false
  ctrl.minimumZoomDistance = 160
  ctrl.maximumZoomDistance = 9000

  // Same block of Chicago the clay map is parked on, for a fair comparison.
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(-87.6285, 41.8745, 620),
    orientation: {
      heading: Cesium.Math.toRadians(40),
      pitch: Cesium.Math.toRadians(-34),
      roll: 0,
    },
  })
}

main().catch(err => {
  const el = document.getElementById('cesium')!
  el.innerHTML =
    `<p style="color:#ff5cab;font:600 15px system-ui;padding:24px">3D tiles failed: ${
      (err as Error).message
    }</p>`
})
