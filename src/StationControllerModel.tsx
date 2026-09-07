/** Camera-matched controller artwork. The parent's pointer regions keep all
 * buttons and sticks interactive without retaining a WebGL context. */
export default function StationControllerModel({ className }: { className: string }) {
  return <img className={className} src="games/poplurstation/controller-poster-v2.png"
    data-model-ready="true" alt="" draggable={false} aria-hidden="true" />
}
