// Poplur Mini-Apps — the schema and the seed catalogue.
//
// The contract (from the Mini-App Builder spec): AI or a user authors a
// STRUCTURED DEFINITION, never executable code. The runtime (AppsScreen's
// MiniAppRunner) interprets that definition with a whitelist of component
// types and action types; an unknown type fails validation instead of doing
// anything. No eval, no injected script, no dynamic code — a definition is
// data the way a Rough Copy capture is data.
//
// This file is Phase 1 of the spec deliberately: schema + validator + the
// first real app (Poplur Flashlight) written IN the schema, so the AI
// generation phase has a runtime to target rather than a demo to replace.

export interface MiniAppComponent {
  type: 'text' | 'heading' | 'button' | 'slider' | 'screenlight'
  /** text / heading / button label */
  text?: string
  /** button action, resolved by the runner's whitelist */
  action?: { type: MiniAppActionType }
  /** slider binding into the app's variables */
  binding?: string
  min?: number
  max?: number
  step?: number
}

export type MiniAppActionType =
  | 'screenlight.toggle'
  | 'variable.toggle'
  | 'navigation.back'

export interface MiniAppScreen {
  id: string
  components: MiniAppComponent[]
}

export interface MiniAppDefinition {
  schemaVersion: 1
  app: {
    id: string
    name: string
    description: string
    /** The emoji the icon tile is built around. Always present: it is what the
        grid draws when no generated icon exists, so an app is never iconless. */
    icon: string
    /** A real icon image, once one has been generated or supplied — a baked
        clay sprite (see meshy.ts + modelSprite, the pipeline the profile
        objects already use) or an uploaded file. Wins over `icon` when set;
        absent is the normal state, not a defect. */
    iconUrl?: string
    /** The app's OWN clay object, as a path to a .glb under Poplur's origin.
        This is the hook for an icon made at creation time — a Meshy or AI
        generated prop dropped into `public/` — so an app is not limited to the
        props the library happens to ship. Rendered by modelSprite exactly like
        the matched ones, so a supplied model and a library one look alike. */
    iconModel?: string
    theme: 'poplur-glitter'
  }
  variables: Record<string, number | boolean | string>
  screens: MiniAppScreen[]
}

const COMPONENT_TYPES = new Set(['text', 'heading', 'button', 'slider', 'screenlight'])
const ACTION_TYPES = new Set(['screenlight.toggle', 'variable.toggle', 'navigation.back'])

/** The only three things an icon URL may be: a baked sprite handed to us as a
 *  data image, a file under Poplur's own origin, or an https URL. Notably NOT
 *  `javascript:` — harmless in an <img src> today, but this schema is a wire
 *  format for generated content and should not rely on where it happens to be
 *  rendered for its safety. */
function isAllowedIconUrl(url: unknown): boolean {
  if (typeof url !== 'string' || !url.trim()) return false
  if (url.startsWith('data:image/')) return true
  if (url.startsWith('/')) return true
  return /^https:\/\//i.test(url)
}

/** The spec's validator: unknown component or action types are a hard fail,
    never a silent skip — a definition that asks for something outside the
    whitelist is treated as untrusted input, because it is. */
export function validateMiniApp(def: MiniAppDefinition): string | null {
  if (def.schemaVersion !== 1) return `Unsupported schemaVersion ${def.schemaVersion}`
  if (!def.app?.id || !def.app?.name) return 'Missing app identity'
  // An icon is a URL a definition asked us to load, and a definition is
  // untrusted input — the same stance the component whitelist takes. Allow only
  // the three shapes an icon can legitimately be, so a generated app cannot
  // point the grid at an arbitrary scheme or an off-site tracker.
  if (def.app.iconUrl != null && !isAllowedIconUrl(def.app.iconUrl)) {
    return 'Unsupported iconUrl'
  }
  // Same stance as iconUrl: a definition is untrusted input, so its model must
  // be a plain relative .glb on our own origin — never a scheme, never a host.
  if (def.app.iconModel != null && !isAllowedIconModel(def.app.iconModel)) {
    return 'Unsupported iconModel'
  }
  if (!Array.isArray(def.screens) || def.screens.length === 0) return 'No screens'
  if (def.screens.length > 8) return 'Too many screens'
  for (const screen of def.screens) {
    if (!Array.isArray(screen.components)) return `Screen ${screen.id} has no components`
    if (screen.components.length > 24) return `Screen ${screen.id} has too many components`
    for (const component of screen.components) {
      if (!COMPONENT_TYPES.has(component.type)) return `Unknown component ${component.type}`
      if (component.action && !ACTION_TYPES.has(component.action.type)) {
        return `Unknown action ${component.action.type}`
      }
    }
  }
  return null
}

/** A generated app may bring its own clay prop. Keep it to a relative path
 *  ending in .glb: no scheme, no protocol-relative `//host`, no traversal. */
function isAllowedIconModel(url: unknown): boolean {
  if (typeof url !== 'string' || !url.trim()) return false
  if (/^[a-z]+:/i.test(url) || url.startsWith('//') || url.includes('..')) return false
  return /\.glb$/i.test(url)
}

/** Poplur Flashlight — the proof-of-concept app, authored in the same schema
    a generated app would arrive in (the spec's Step 12 requirement: no
    hard-coded separate flashlight). The screenlight component is the phone's
    screen AS the torch: full-bleed colour, cycling the rainbow while ON. */
export const FLASHLIGHT_APP: MiniAppDefinition = {
  schemaVersion: 1,
  app: {
    id: 'poplur-flashlight',
    name: 'Poplur Flashlight',
    description: 'Illuminates rainbow colours, repeatedly.',
    icon: '🔦',
    theme: 'poplur-glitter',
  },
  variables: {
    on: false,
    /** rainbow steps per second-ish; the slider writes this */
    speed: 2,
  },
  screens: [
    {
      id: 'home',
      components: [
        { type: 'screenlight' },
        { type: 'heading', text: 'FLASHLIGHT' },
        { type: 'button', text: 'ON / OFF', action: { type: 'screenlight.toggle' } },
        { type: 'slider', binding: 'speed', min: 1, max: 8, step: 1 },
      ],
    },
  ],
}

const CREATED_APPS_KEY = 'poplur.miniapps.v1'

/** The account's apps: the seeded flashlight plus anything created later.
    Created definitions are validated on read — a stored app that no longer
    passes the whitelist is dropped rather than interpreted loosely. */
export function listMiniApps(): MiniAppDefinition[] {
  let created: MiniAppDefinition[] = []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CREATED_APPS_KEY) ?? 'null')
    if (Array.isArray(parsed)) {
      created = parsed.filter((def: MiniAppDefinition) => validateMiniApp(def) === null)
    }
  } catch { /* private mode */ }
  return [FLASHLIGHT_APP, ...created]
}

export function saveMiniApp(def: MiniAppDefinition): string | null {
  const problem = validateMiniApp(def)
  if (problem) return problem
  try {
    const existing = listMiniApps().filter(app => app.app.id !== def.app.id && app.app.id !== FLASHLIGHT_APP.app.id)
    window.localStorage.setItem(CREATED_APPS_KEY, JSON.stringify([...existing, def]))
  } catch { /* private mode */ }
  return null
}
