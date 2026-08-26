/** The iPod's library section that currently owns its screen. `null` means no
 *  iPod surface is open; `root` covers every ordinary iPod frame, while the
 *  Podcasts library deliberately lends the persistent navigator its folder. */
export type IpodSection = 'root' | 'podcasts'

export const IPOD_SECTION_CHANGE_EVENT = 'poplur-ipod-section-change'
export const IPOD_PODCASTS_CUBE_MODEL = 'poplur_cube_folder.glb'

/** Frame ids stay internal to MapIpod. The shell only needs the one distinction
 *  that changes the navigator object. */
export function ipodSectionForFrame(frameId: string): IpodSection {
  return frameId === 'podcasts' ? 'podcasts' : 'root'
}

/** A narrow override: no iPod, and every ordinary iPod frame, fall through to
 *  the screen's normal object. Only the Podcasts library becomes a folder. */
export function ipodNavigatorOverride(section: IpodSection | null): string | undefined {
  return section === 'podcasts' ? IPOD_PODCASTS_CUBE_MODEL : undefined
}

export function announceIpodSection(section: IpodSection | null): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(IPOD_SECTION_CHANGE_EVENT, { detail: { section } }))
}

export function sectionFromIpodEvent(event: Event): IpodSection | null {
  const section = (event as CustomEvent<{ section?: unknown }>).detail?.section
  return section === 'root' || section === 'podcasts' ? section : null
}
