import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * One tap on publish must produce exactly ONE post.
 *
 * It produced two for 24 days. The web composer sent a single `publishPost`
 * message; the iOS shell dispatched that one message twice. PostLoginHomeWebView
 * handled it and then — unlike its `signOut` sibling — fell through to an
 * unconditional forward into its `bridge`, whose switch ALSO had a
 * `case "publishPost"`. Two Storage objects, two posts documents, two seconds
 * apart, from one tap.
 *
 * The second run found the publish contract already drained by the first (the
 * handler is synchronous, the upload observer defers into a Task), so it fell
 * back to a minted post id and a 5000m default radius — inventing 5km of reach
 * the account had not earned, which then grew on engagement.
 *
 * This is a cross-repo contract: the web emits, iOS handles. The iOS half is
 * asserted only when that checkout is present, so this suite still passes for
 * anyone working on the web app alone.
 */
const IOS = new URL('../../../Poplur2025-iOS/Poplur2025/', import.meta.url)
const web = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
const ios = (f: string) => readFileSync(new URL(f, IOS), 'utf8')
const iosPresent = existsSync(new URL('PostUploadService.swift', IOS))

describe('the web composer sends one publish per tap', () => {
  const composer = web('PostComposer.tsx')

  it('emits exactly one publishPost message', () => {
    expect(composer.match(/type: 'publishPost'/g)?.length ?? 0).toBe(1)
  })

  it('reuses one client post id across retries', () => {
    // A retry that minted a fresh id would defeat every id-based dedupe
    // downstream — which is the only dedupe that can tell a repeat apart from
    // a legitimate fast second post.
    expect(composer).toContain('const postIdRef = useRef(createClientPostId())')
    expect(composer).toContain('postId: postIdRef.current')
  })

  it('disables the control while a publish is in flight', () => {
    expect(composer).toContain('disabled={publishing')
  })
})

describe.skipIf(!iosPresent)('the iOS shell handles one publish once', () => {
  it('the map bridge coordinator no longer publishes', () => {
    // The single change that would have prevented the incident.
    expect(ios('PoplurClayMapView.swift')).not.toContain('case "publishPost"')
  })

  it('the home coordinator forwards selectively, not unconditionally', () => {
    const home = ios('PostLoginHomeWebView.swift')
    expect(home).toContain('if forwardToBridge {')
    // publishPost must never be in the forward set — this class owns it.
    const owned = home.match(/bridgeOwnedTypes: Set<String> = \[([^\]]*)\]/)?.[1] ?? ''
    expect(owned).not.toContain('publishPost')
    expect(owned).toContain('pop')
  })

  it('a drained publish contract fails instead of inventing an identity', () => {
    const upload = ios('PostUploadService.swift')
    expect(upload).not.toContain('?? "post-\\(UUID().uuidString)"')
    expect(upload).not.toContain('?? 5000')
    expect(upload).toContain('guard let postID = Self.boundedPostID(candidate) else { return nil }')
  })

  it('deduplicates on post id, the one key a repeat shares', () => {
    // The old guard compared ObjectIdentifier(image) — a memory address — so
    // two decodes of byte-identical media never matched.
    expect(ios('PostUploadService.swift')).toContain('if postID == other.postID { return true }')
  })
})
