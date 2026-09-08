# Conquer landmark wall and complete profile totals

Conquer Board now has two manually selected pages: Rankings and Landmarks.
There is no close button; the existing shell cube/back and keyboard Escape
handle navigation out of Conquer.
The second page displays all 13 shipped landmark GLBs as static 320px images.
Uncovered landmarks use their image alpha as a silhouette; currently covered
landmarks show the complete model artwork and a conquered badge. Image/source
hashes are recorded in `conquerLandmarkManifest.json`; regenerate with
`node scripts/bake-conquer-landmarks.mjs`.

Coverage is computed from individual active, public, explicitly located posts.
The landmark's existing Map coordinate must fall inside at least one post's
great-circle radius. Overlaps count the landmark once. The shared world-radius
rule still applies. Hidden or missing origins never invent a location, and the
account's sum of distant radii is never used as one coverage circle. As requested,
coverage ending (shrink, expiry or deletion) returns the landmark to its silhouette.
No permanent unlock storage or landmark posting bonus is introduced.

Profiles previously summed only the capped Feed pool (and its capped own-post
extension). The new author-specific subscription has no Feed limit, deduplicates
immutable post IDs, and computes total full reach separately from renderable
media. It includes valid published radius even when the client cannot display
that post's media URL. Seed and organic portions are not added twice, while
each individual post is clamped to the existing world scale. Nonpublic, expired,
deleted and zero-radius posts do not count. The total may exceed one post's
ceiling because it is a sum of distinct posts.

Browsers query Firestore directly. Native iOS/Android use their signed-in Firebase
session through `AuthoredPostsBridge`, with explicit start/stop requests tied to
the visible screen. Query generations isolate users and discard late callbacks.
Both paths wait for a complete server query, since a first cache-only response
may itself contain only Feed's subset. A later connection error retains the last
complete total. Native payloads exclude nonpublic rows, private coordinates and
unrelated document fields before crossing into the page.

The landmark listener is active only on page two. Ranking animation parks on
that page, and listeners stop when backgrounded, closed or switching accounts.
No landmark GLBs, WebGL context or animation loop is added to the wall.

Verification covers a 240-post author, missing media, duplicate IDs, seeds,
privacy, cache-only versus complete responses, late callbacks, background
cleanup, coverage boundaries, live relocking, overlaps and world coverage.
The component test verifies pagination, all 13 cards, fill/relock state, and
zero canvas/model-viewer elements. The source/output asset hashes are checked.
Android tests cover native publication/privacy filtering. Native build and
device receipts are recorded in the workspace install report.

Canonical Good Copy and Rough Copy files are unchanged. Native iPhone and
Android releases are coordinated with the concurrent interaction fixes;
iPad remains deferred and Expo is excluded.
