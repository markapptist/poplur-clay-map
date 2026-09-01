# Radius system test plan

What to test before trusting radius growth, decrease, and rate of growth.
Grounded in the shipped mechanics: `feedDiscovery.feedPostReachesViewer` /
`mapLivePosts.liveMapPinGhost` (interception), `radiusLedger.ts` (local event
ledger), `feedEngagements.recordPostEngagement` (server authority via Cloud
Function), and the `posts` rules' server-owned engagement fields
(`radius`, `organicRadiusMeters`, `boostedRadiusMeters`, `boostExpiresAt`).

Actors: create fresh synthetic accounts with the shared first-user journey
(`first-user-shared-v1`, Test Center → "Watch a separate real tester"), one per
role: **Poster** (owns the post) and **Viewer** (drives engagement). Verify
server state by unauthenticated REST reads of `posts/{postId}` (public rule),
never by trusting client UI alone.

## A. Interception (the contract — baseline done 1 Sep)

- [x] radius 0 → ghost pin on Map, absent from Feed (verified with the live
      tester post `post-03d39e1a…`).
- [ ] radius just **below** viewer distance → ghost pin + not in Feed.
- [ ] radius just **above** viewer distance → filled pin + present in Feed —
      the same post flips BOTH surfaces at the same boundary, same math.
- [ ] Poster always sees their own pin filled regardless of radius (`mine`).
- [ ] Hidden-origin post (`locationVisibility: 'hidden'`) → neither surface,
      never a ghost (privacy fails closed, not dotted).
- [ ] No location fix (native, denied) → everything ghosts / Feed empty of
      live posts (fail closed), preview keeps the deterministic Toronto origin.

## B. Growth

- [ ] First qualified view → exactly one grant (`view`), recorded server-side
      on the post doc; `viewCount` and `radius` move together.
- [ ] Replay: second watch **within 30 s** grants nothing; after a ≥30 s break
      grants the half-rate replay (+0.5 km local ledger) — remount/decoder
      recovery must not count (REPEAT_VIEW_MIN_MS guard).
- [ ] Like +1 km, comment +2 km, share, profile-visit — each kind grants its
      table rate, once per actor per post (unlike removes the engagement doc —
      does the radius grant revert?).
- [ ] Engagement by the **Poster on their own post** must not grow it.
- [ ] One actor repeating the same kind N times → 1 grant, not N (anti-farm).
- [ ] Two distinct actors → 2 grants (growth scales with people, not events).
- [ ] Growth while the radius crosses a viewer's distance → that viewer's Map
      pin un-ghosts and the post enters their Feed WITHOUT reload (realtime).

## C. Decrease

- [ ] Dislike −1 km; radius floors at 0, never negative.
- [ ] Inactivity: a post with **no view within 1 h of posting** takes the −1
      inactive hit exactly once (`inactivityApplied` idempotence).
- [ ] Boost expiry: `boostedRadiusMeters` stops counting after
      `boostExpiresAt`; delivery must use organic-only after expiry (does the
      stored `radius` get rewritten, or must readers subtract?).
- [ ] Long-horizon decay (product model says radius decays): measure a posted
      radius over 24 h / 7 d with zero engagement — document the actual curve;
      if no server decay exists yet, record that as a gap.
- [ ] Decrease crossing a viewer's distance → pin re-ghosts + drops out of
      that viewer's Feed in realtime.

## D. Rate of growth

- [ ] Per-kind rate table matches spec: view 1, replay 0.5, like 1, comment 2
      (local ledger) — and whatever `recordPostEngagement` grants server-side.
      **The two ledgers must agree**; today the browser ledger lives in
      localStorage per device and the server owns the post doc — measure drift.
- [ ] Burst behavior: 10 actors engaging in one minute — grants sum linearly,
      or is there a velocity cap? Document observed rate limiting.
- [ ] `incrementPostView` (RN `posts.ts`) writes `radius: increment(100)`
      client-side — production rules deny engagement-field writes, so this
      path should be DEAD. Verify it fails, and remove or reroute it.
- [ ] Paid boost: purchase → `boostedRadiusMeters` set, `radiusBoostTransactions`
      row exists, client cannot forge either (rules: write false).
- [ ] Radius chip ("X mi of 3,959 mi"), pin `radiusDeltaKm` chips, profile
      totals, and the post doc all report the SAME number at rest.

## E. Authority

- [ ] Client attempts to write `radius` / `viewCount` / `boostedRadiusMeters`
      directly (owner update, non-owner update) → all denied by rules.
- [ ] Engagement create is denied to clients (`engagements` create: false) —
      only the Cloud Function path moves counters.
- [ ] Deleting an engagement (unlike / owner moderation) — verify what happens
      to the granted radius.

## F. Asymmetry (reach.ts)

- [ ] you→them vs them→you: a big-radius post reaches a small-radius account
      while the reverse stays false — phone/call affordances show the pair
      (`outgoing` / `incoming` / `both` / `none`) consistently with Map/Feed.

Notes for the runner: grow a test post's radius through the **visible UI**
(views/likes from a second synthetic account), not by editing documents — the
rules exist to make document edits impossible, so a test that edits documents
tests nothing.
