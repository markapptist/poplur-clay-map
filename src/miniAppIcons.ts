// Which clay object stands for a mini-app.
//
// Poplur already owns a library of cartoony clay props, and modelSprite bakes
// their thumbnail views offline. Every rule below is covered by
// spritePrerender.json, so opening Apps only loads PNGs; no device-side model
// downloads, Draco decodes or rendering contexts are needed for stock icons.
//
// The match is made from the app's own words and the components its screen
// actually uses, so it is derived from the definition rather than assigned by
// hand. `iconUrl` still wins outright when a real icon is supplied.
//
/** Word-START matching, never bare substring. "Illuminates repeatedly" contains
 *  "eat", so a plain `includes` gave the flashlight a knife and fork — and that
 *  class of collision ("art" in "start", "map" in "champion") would mis-icon
 *  generated apps constantly. Anchoring to a word boundary still allows the
 *  suffixes that matter: "illuminate" matches "illuminates", "track" matches
 *  "tracker". Escaped because these are authored strings, not patterns. */
function matches(hay: string, word: string): boolean {
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(hay)
}

const RULES: { model: string; words: string[] }[] = [
  { model: 'poplur_moon_crescent_lite.glb', words: ['moon', 'night', 'sleep', 'dream', 'dark'] },
  { model: 'poplur_cube_wallet.glb', words: ['wallet', 'money', 'budget', 'pay', 'bank', 'expense', 'cash'] },
  { model: 'poplur_cube_coin.glb', words: ['coin', 'credit', 'token', 'tip', 'reward', 'point'] },
  { model: 'poplur_cube_shopping_bag.glb', words: ['shop', 'buy', 'cart', 'order', 'deal'] },
  { model: 'poplur_cube_fork_knife.glb', words: ['food', 'eat', 'recipe', 'meal', 'menu', 'kitchen', 'restaurant'] },
  { model: 'poplur_cube_camera_lens.glb', words: ['camera', 'photo', 'picture', 'shot', 'lens', 'selfie'] },
  { model: 'poplur_cube_video.glb', words: ['video', 'film', 'movie', 'clip', 'record'] },
  { model: 'poplur_radio.glb', words: ['radio', 'music', 'song', 'audio', 'sound', 'playlist', 'album'] },
  { model: 'poplur_mic_lite.glb', words: ['mic', 'voice', 'speak', 'podcast', 'karaoke'] },
  { model: 'poplur_cube_mail_envelope.glb', words: ['mail', 'inbox', 'letter', 'email', 'send'] },
  { model: 'poplur_cube_comment.glb', words: ['chat', 'comment', 'message', 'talk', 'reply'] },
  { model: 'poplur_cube_contact.glb', words: ['contact', 'friend', 'people', 'profile', 'buddy', 'team'] },
  { model: 'poplur_cube_map.glb', words: ['map', 'travel', 'trip', 'world', 'globe', 'place', 'city', 'explore'] },
  { model: 'poplur_cube_directions.glb', words: ['direction', 'navigate', 'route', 'compass', 'go'] },
  { model: 'poplur_pin_lite.glb', words: ['pin', 'location', 'drop', 'spot', 'here', 'near'] },
  { model: 'poplur_cube_bargraph.glb', words: ['stat', 'chart', 'graph', 'count', 'track', 'metric', 'report', 'data', 'stock', 'market', 'price', 'trade', 'budget'] },
  { model: 'poplur_cube_trophy.glb', words: ['trophy', 'win', 'score', 'game', 'challenge', 'streak', 'quiz'] },
  { model: 'poplur_cube_slot_machine.glb', words: ['slot', 'luck', 'random', 'spin', 'dice', 'guess'] },
  { model: 'poplur_cube_gear.glb', words: ['setting', 'config', 'tool', 'control', 'tune', 'utility'] },
  { model: 'poplur_cube_folder.glb', words: ['folder', 'file', 'doc', 'note', 'list', 'save', 'archive'] },
  { model: 'poplur_newspaper.glb', words: ['news', 'read', 'book', 'story', 'paper', 'article'] },
  { model: 'poplur_cube_laptop.glb', words: ['laptop', 'code', 'work', 'build', 'dev', 'study'] },
  { model: 'clay_tv.glb', words: ['tv', 'watch', 'show', 'channel', 'stream'] },
  { model: 'poplur_cube_search.glb', words: ['search', 'find', 'lookup', 'scan'] },
  { model: 'poplur_bell.glb', words: ['bell', 'alert', 'remind', 'notify', 'alarm', 'timer'] },
  { model: 'poplur_clay_phone_lite.glb', words: ['phone', 'call', 'dial', 'ring'] },
  { model: 'poplur_cube_printer.glb', words: ['print', 'receipt', 'label'] },
  { model: 'poplur_cube_store.glb', words: ['store', 'market', 'shelf'] },
]

/** The CREATE cube: what an app gets when nothing in its words matches. Not a
 *  failure state — these are apps you made with Poplur AI, so "create" is the
 *  honest label. Deliberately not `poplur_icon_cube.glb`: that is the login
 *  cube and its face is a checkmark, which reads as "done" on an app icon.
 *
 *  NOTE: every model named here was baked at icon size and inspected. The clay
 *  SUN was dropped after that pass — at 68px it is a featureless yellow ball —
 *  which is why nothing maps "flashlight"/"torch"/"light" today. There is no
 *  torch prop in the library. Add one to `public/` and give it a rule here and
 *  it will be picked up automatically; `iconUrl` overrides all of this. */
export const DEFAULT_MINI_APP_MODEL = 'poplur_cube_create.glb'

/** Pick the clay object for an app from its own name, description and the
 *  component types its first screen renders. Deterministic: the same app
 *  always gets the same object. */
export function modelForMiniApp(input: {
  name: string
  description: string
  componentTypes?: readonly string[]
  /** The app's own prop, if one was made for it at creation time. Always wins:
   *  a matched library prop is a stand-in, an authored one is the real icon. */
  iconModel?: string
}): string {
  if (input.iconModel) return input.iconModel
  const hay = `${input.name} ${input.description} ${(input.componentTypes ?? []).join(' ')}`.toLowerCase()
  for (const rule of RULES) {
    if (rule.words.some(word => matches(hay, word))) return rule.model
  }
  return DEFAULT_MINI_APP_MODEL
}
