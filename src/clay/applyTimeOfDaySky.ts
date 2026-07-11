// Real time-of-day sky: the Cesium clock tracks the actual current time, so
// the sun/moon/stars and the atmosphere render wherever they really are.
// Zoom out to the globe by day → sunlit blue limb; by night → dark side with
// stars. Street level inherits the same light direction, so photogrammetry
// dims naturally after sunset instead of pretending it's noon.

type CesiumNamespace = any
type CesiumViewer = any

const CLOCK_RESYNC_MS = 60_000

export function applyTimeOfDaySky(Cesium: CesiumNamespace, viewer: CesiumViewer): () => void {
  const scene = viewer.scene

  // Space is black; the atmosphere paints the daytime blue. Stars, sun and
  // moon are all positioned from the (real) clock time.
  scene.backgroundColor = Cesium.Color.BLACK
  if (scene.skyBox) scene.skyBox.show = true
  if (scene.sun) scene.sun.show = true
  if (scene.moon) scene.moon.show = true
  if (scene.skyAtmosphere) {
    scene.skyAtmosphere.show = true
    // Day/night shading follows the sun rather than the camera.
    if ('dynamicLighting' in scene.skyAtmosphere) {
      try { scene.skyAtmosphere.dynamicLighting = Cesium.DynamicAtmosphereLightingType.SUNLIGHT } catch { /* older Cesium */ }
    }
  }
  scene.light = new Cesium.SunLight()

  viewer.clock.currentTime = Cesium.JulianDate.now()

  // Google's photorealistic tiles are UNLIT (daylight baked into the photo
  // textures), so the sun can't shade them into night. A one-tap post stage
  // dims the whole scene by the real sun elevation at the camera instead:
  // full brightness by day, a moonlit 0.35 after dark, dusk in between.
  let dimStage: any
  try {
    dimStage = scene.postProcessStages.add(new Cesium.PostProcessStage({
      name: 'poplur_time_of_day_dim',
      fragmentShader: `
        uniform sampler2D colorTexture;
        uniform float u_dim;
        in vec2 v_textureCoordinates;
        void main() {
          vec4 color = texture(colorTexture, v_textureCoordinates);
          // Night is dim AND slightly cool — moonlight, not a grey filter.
          vec3 night = color.rgb * vec3(0.82, 0.88, 1.0);
          out_FragColor = vec4(mix(night, color.rgb, u_dim) * mix(0.35, 1.0, u_dim), color.a);
        }
      `,
      uniforms: { u_dim: 1.0 },
    }))
  } catch { /* post-processing unsupported — sky/stars still reflect the time */ }

  const scratchSun = new Cesium.Cartesian3()
  const updateDim = () => {
    if (!dimStage) return
    try {
      // Sun elevation at the camera: +1 overhead, -1 antipodal midnight.
      const sunInertial = Cesium.Simon1994PlanetaryPositions
        .computeSunPositionInEarthInertialFrame(viewer.clock.currentTime, scratchSun)
      const toFixed = Cesium.Transforms.computeIcrfToFixedMatrix(viewer.clock.currentTime)
      const sunFixed = toFixed
        ? Cesium.Matrix3.multiplyByVector(toFixed, sunInertial, scratchSun)
        : sunInertial
      const up = Cesium.Cartesian3.normalize(viewer.camera.positionWC, new Cesium.Cartesian3())
      const sunDir = Cesium.Cartesian3.normalize(sunFixed, new Cesium.Cartesian3())
      const elevation = Cesium.Cartesian3.dot(up, sunDir)
      // Day above +0.10, night below -0.12, smooth dusk between.
      const t = Math.max(0, Math.min(1, (elevation + 0.12) / 0.22))
      dimStage.uniforms.u_dim = t * t * (3 - 2 * t)
    } catch { /* ephemeris unavailable — leave daylight */ }
  }
  updateDim()
  const removeCamListener = viewer.camera.changed?.addEventListener
    ? (viewer.camera.changed.addEventListener(updateDim), () => viewer.camera.changed.removeEventListener(updateDim))
    : undefined

  // The clock is not animating (no timeline widget), so nudge it back to real
  // time once a minute — enough for the terminator to stay honest without
  // per-frame work.
  const resync = window.setInterval(() => {
    viewer.clock.currentTime = Cesium.JulianDate.now()
    updateDim()
    scene.requestRender?.()
  }, CLOCK_RESYNC_MS)

  return () => {
    window.clearInterval(resync)
    removeCamListener?.()
    if (dimStage) {
      try { scene.postProcessStages.remove(dimStage) } catch { /* viewer already destroyed */ }
    }
  }
}
