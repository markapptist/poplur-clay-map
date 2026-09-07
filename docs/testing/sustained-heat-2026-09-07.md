# Sustained-use thermal correction — 7 September 2026

## Problem and changes

A renewable 15-second idle timer allowed ambient rendering to run throughout a session of repeated touches. Native taps now request at most three seconds of decorative work followed by twelve seconds of rest. The rest is shared with same-origin child documents, so remounting the map cannot reset it. Native `fair` thermal / reduced policy signals leave decoration parked even when tapped. Direct gestures and managed operations retain separate rendering leases, and the native globe/disco turn obeys the same ambient budget. Existing first-paint, camera-aiming, motion, media and lifecycle paths remain separate.

The shared clay-button renderer previously resized its GPU buffer twice per blit. It now keeps a high-water buffer and renders into a per-button viewport. The navigator also avoids a redundant buffer resize when its renderer lease changes without a resolution change.

A second physical-device report showed a black camera. Saved native camera records confirm it was parked at `serious` heat with no captured frame. The web now retains early native state delivery and displays a static availability card with the photo library still accessible. Native policy recovery from serious to fair updates the explicit resume action even while the broader thermal tripwire remains latched. It does not automatically restart capture or bypass the serious/critical stop.

## Evidence

- Physical iPhone baseline: 15 minutes, 16:57:16–17:12:16 UTC, with 639 seconds of paired foreground samples. Foreground main WebContent CPU averaged 16.69% of one core; GPU-process CPU averaged 9.49%. Device-wide GPU utilization averaged 22.86% while Poplur was foreground. Device-wide GPU utilization is not app-exclusive.
- iOS reported `fair` at 17:00:31 and `serious` at 17:07:16. The latter transition occurred after a background edge. Charging changed from false in the preceding foreground log to true at the thermal edge. The user also reports overheating unplugged; this mixed baseline does not establish charging as a cause or measure an unplugged-only session.
- Main WebContent footprint peaked at 1,608 MiB and finished at 872 MiB. These numbers show high transient allocation; they do not establish a retained-memory leak.
- A native macOS WKWebView before/after render comparison drew 240 frames at alternating 40/44/56 CSS-pixel button sizes. Every pixel hash matched. Canvas width/height writes fell from 720 each to 244 each (including 240 required destination-canvas initializations). This is a rendering-operation comparison, not an iPhone temperature measurement.
- The real frame-governor module passes ten simulated minutes of 1,200 taps: decorative callbacks remain below the three-seconds-per-fifteen-seconds budget, every gesture progresses, long dragging and explicit managed operations continue during rest, and a settled clock stops completely. Separate coverage verifies iframe budget sharing and no decorative restart under `fair`.
- All 22 targeted tests pass, including camera recovery UI actions, early state delivery, motion, lifecycle, visibility and map thermal coverage. The older AR navigation assertion was updated to match the already-shipped permanent AR rail; returning still resets its selected filter to None. TypeScript and the governed-loop check pass.

## Validation status

The guarded native bundle release passed without skips. Native iOS build/signature checks, Android release assembly and Android unit/debug checks passed. All 1,054 frozen web files were verified in both packages. Runtime commits `854ca53` (web), `6aa104cd` (iOS) and `7bdeb91` (Android) were pushed. The iPhone installation was verified and the user confirmed a live camera preview. The iPad installation was verified, but it disconnected before launch. The Android phone was disconnected and its package is not installed there.

The 15-minute physical follow-up, 17:40:51–17:55:51 UTC, **failed the thermal outcome**. It started warm at `fair`, reached `serious` at 17:45:21 during repeated Map/Camera/Feed/Profile navigation, and returned to `fair` at 17:48:41. The camera recovery is a functional fix; overheating is not resolved.

There were 764 seconds of paired foreground samples. Foreground main WebContent CPU averaged 7.56% of one core, GPU-process CPU 2.62%, and device-wide GPU utilization 5.69%. Main WebContent footprint peaked at 1,469 MiB. These averages include long quiet periods and different actions from the baseline; do not express them as a causal percentage improvement. A 15-second navigation window still reached 65.5% main WebContent CPU and 45.5% device-wide GPU utilization. The session began charging and is not an unplugged-only validation.

## Follow-up Map startup experiment

The adaptive map still constructed the classic Dark/Mercator style at street zoom 14.8 on every return, then immediately jumped to its intended world-scale view. That bootstrap was a workaround for the retired Standard/globe style. Constructing the current style directly at its intended zoom removes the discarded street-tile load.

Two before and two after desktop browser runs measured mean renderer-thread CPU duration of 1.899 seconds and 1.497 seconds respectively over each 20-second arrival window (about 21% less). The two street-vector requests were eliminated; total `.pbf` requests, including glyphs and the icon set, fell from eight to four. Each run reached a parked map without runtime exceptions. A native macOS WKWebView screenshot confirmed a visible map with the same artwork. These are startup-operation measurements, not iPhone thermal proof. This follow-up still requires the guarded release and device validation.

Raw local evidence: `/Users/matrix/Developer/.codex/profiling/sustained-heat-20260907/`.
