/** Authored console artwork keeps the startup mark without a second renderer
 * alongside the game that is loading. Its entrance animation ends after 2.2s. */
export default function StationBootModel({ className }: { className: string }) {
  return <img className={className} src="navigator-sprites/games_poplurstation_console_y0_p0.webp"
    data-model-ready="true" data-baked-station-boot alt="" draggable={false} aria-hidden="true" />
}
