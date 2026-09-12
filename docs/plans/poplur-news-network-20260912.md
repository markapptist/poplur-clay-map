# Poplur News: a global social news network

Plan for review — September 12, 2026. This proposes the news build; it does not change the current news screen.

## Product direction

Turn The Poplur Times into a live, account-led news feed: recognizable reporters, publishers, creators, eyewitnesses, photos, video, conversations, and hashtags. Keep Poplur's identity, but make the feed easy to scan and follow like Twitter/X. The newspaper masthead becomes compact; the timeline and people take priority over a large lead article.

The code today explains the screenshot: the RSS fallback reads four BBC feeds and creates records with an empty media array. The shared story model supports photos/videos and sources, but lacks a first-class author account, hashtags, threads, and following relationships. A visual redesign alone will not supply the requested content.

## The experience

Top navigation: For You, Following, World, Nearby, and Video. Search finds posts, accounts, places, and hashtags. World defaults to broad international coverage; Following is chronological. Nearby uses the user's chosen radius or chosen place, without requiring precise location to browse.

Each timeline post contains:
- Real avatar, display name, handle, source platform, and timestamp.
- A clear identity label: Poplur account, linked external account, or imported publisher. An imported account is never presented as having joined Poplur.
- Original post text or a permitted article excerpt; an expandable long-post view.
- Inline photo, video poster/player, quote, or article preview with source attribution.
- Clickable author hashtags; separate related-topic chips when Poplur adds classification.
- Reply, repost/quote, like, save, and share. These actions operate inside Poplur unless the user deliberately connects and acts on an external account.
- Source engagement counts, if available, explicitly separated from Poplur reactions. Missing counts remain absent rather than invented.

Tapping an author opens a source profile with bio, original profile link, recent posts, and Follow in Poplur. Tapping a post opens its thread and sources. Links open in Poplur Browser. Navigation back restores the exact scroll position. The feed has enough bottom clearance that the camera/news controller and radius readout never cover a post's actions.

## Real accounts around the world

Start with a reviewed directory of approximately 60–100 real public accounts, spanning North America, Latin America/Caribbean, Europe, Africa, Middle East, South Asia, East/Southeast Asia, and Oceania. Include independent reporters and local outlets alongside national publishers, science/weather organizations, and public-interest institutions. This is a proposed onboarding target, not a claim that accounts are already connected.

Candidate source mix for the directory: Reuters/AP for international reporting; BBC/DW/France 24 for Europe; Africanews and local reporters for Africa; Al Jazeera and local reporters for the Middle East; NHK/CNA and local reporters for Asia; ABC Australia for Oceania; and regional Spanish/Portuguese-language outlets for Latin America. Each is a candidate to verify for a permitted feed, not an integration commitment. ABC's [official social directory](https://help.abc.net.au/hc/en-us/articles/360003348876-ABC-s-social-media-directory) already identifies its Bluesky and YouTube accounts; [Africanews describes its African and international coverage](https://www.africanews.com/page/about/). Use these official-site links as the model for source verification, then add individual correspondents rather than filling the whole feed with institutional logos.

Verify each account using stable platform IDs plus a link from the publisher's or person's official website where available. Store the evidence, region, languages, topics, and review date. A paid badge or account popularity is not proof that every post is accurate. External verification labels retain their platform attribution.

Start with public Bluesky and Mastodon accounts plus publisher RSS, and official YouTube channels for video. Add direct Poplur reporting as a distinct source type. Integrate X only after developer access, permitted display/storage behavior, and a spending cap are configured. Do not make the first release dependent on access to X.

The Bluesky post schema carries author identity and video embed views. Mastodon's status model includes author accounts, media attachments, hashtags, language, and thread relationships. These are better inputs for an account-led product than headline-only RSS. See [Bluesky's post schema](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/feed/defs.json) and [Mastodon's status documentation](https://docs.joinmastodon.org/entities/Status/).

## Video that works on a phone

Show original uploaded video where distribution rights permit it, otherwise the provider's official embedded player. YouTube supports player control through its [IFrame Player API](https://developers.google.com/youtube/iframe_api_reference). Keep attribution and source links attached to the video.

One visible player at a time; muted inline playback where supported, tap for sound/fullscreen, captions where supplied, poster fallback when playback is unavailable. Pause and release offscreen players, stop playback when the tab is hidden, and avoid loading several embedded players at once. Data Saver disables autoplay and prefetch. Preserve vertical and horizontal aspect ratios.

Begin with video from the reviewed account directory and official channels. Do not download or rehost arbitrary videos just because their posts are public. A deleted/private/unavailable original becomes an unavailable-media card with updated state, not a broken player.

## Hashtags and discovery

Recognize Unicode hashtags in imported and native posts, preserving the original text while indexing a normalized key. A hashtag opens Top, Latest, and Video results, with region/language filters and an option to follow the topic. Suggested topics belong in the composer and search, not silently inserted into a reporter's words.

Trending topics are based on recent growth in unique participating accounts and diverse sources, with spam/repetition controls. Label scope and window: “Trending in Toronto · past 6 hours.” Do not label a single frequently reposted headline a worldwide trend. Merge genuine duplicate tags cautiously; translations are related topics, not automatically identical tags.

## News judgment and Poplur's radius

Group posts about the same event into an optional story page: original reports, eyewitness posts, timeline updates, and other coverage. Preserve each author's individual post and timestamp. Distinguish reporting, opinion, firsthand claims, corrections, and AI-assisted summaries. Multiple copies of one wire report count as one source, not independent corroboration.

Ranking starts with recency, followed accounts/topics, geographic relevance, originality, source variety, and quality of discussion. Limit repeated posts from one outlet and near-duplicate coverage. Use language preferences plus optional translation with the original one tap away. Let users mute accounts/hashtags, report posts, and switch to chronological order.

External news should show its sourced location or coverage area. Only use coordinates supported by the source; “World” is better than a guessed map pin. Do not invent a Poplur account radius for an imported author. If Poplur engagement earns a story reach, label it explicitly as reach within Poplur. Native Poplur authors keep their genuine account identity and radius.

## Implementation

Create a common NewsPost record: stable provider/post ID, source URL, author reference, text, language, authored hashtags, optional topic classifications, media metadata and permission mode, thread/repost parent, event reference, location with provenance, timestamps, source metrics, Poplur metrics, and availability state.

Create NewsAccount, NewsFollow, NewsTopicFollow, NewsEvent, and ingestion-cursor records. Extend the current news API with cursor pagination and feed filters; replace the current single 40-story snapshot as the primary feed while preserving it as a fallback during migration.

Provider adapters run server-side, normalize records, sanitize imported markup, deduplicate, refresh availability, and cache shared results. Clients never poll every source independently. Ingestion uses per-provider rate limits, retry/backoff, and a health dashboard. Prioritize active/breaking sources; refresh slower sources less often. Track collection delay separately from publication time.

X's documentation currently describes [pay-per-usage billing](https://docs.x.com/x-api/fundamentals/post-cap), so an X connector needs a hard monthly budget, usage alerts, and graceful fallback to the other feeds. No provider subscription or paid ingestion is authorized by this plan.

## Delivery sequence

1. **Source foundation:** verified account directory, two social adapters plus RSS, account/post schema, deduplication, paginated API, health dashboard, and honest stale/error states. Acceptance: real identities and original links survive ingestion; no placeholder authors or fabricated counters.
2. **Timeline and video:** compact masthead, rich posts, author profiles, World/Video views, controlled video playback, Poplur Browser links, and reliable scroll restoration. Acceptance: representative videos from each supported provider play or show a useful fallback; hidden players stop.
3. **Following and hashtags:** account/topic follows, chronological Following, hashtag pages, unified search, native Poplur replies/reposts/saves. Acceptance: persistence across devices, proper Unicode tags, and clearly separated external versus Poplur engagement.
4. **Discovery and local coverage:** For You/Nearby, transparent trends, event clustering, language/translation options, moderation controls, and geographic diversity tuning.
5. **Release:** exercise slow/offline networks, unavailable/deleted posts, missing media, duplicate sources, blocked accounts, pagination, accessibility, and native phone/tablet performance. Roll out behind a flag before replacing the current newspaper feed.

Initial review targets: no invented identities or counts; priority-source freshness within 10 minutes and ordinary sources within 30 minutes when providers are healthy; a diverse opening World feed whenever enough fresh coverage exists; one active video decoder; zero hidden playback; no unrelated location inferred from the viewer. Tune numerical performance and coverage targets against a pilot rather than promising them before source access is confirmed.

Recommended first milestone: a working World + Video timeline with real source accounts and clickable hashtags. Add personalization once that feed is demonstrably useful and fresh.

## Milestone 1 implementation — September 12, 2026

Implemented World and Video tabs, a compact timeline, source profiles, and Unicode hashtag filters. The importer reads reviewed public Bluesky accounts for ABC Australia, Reuters, AP, France 24, The Guardian, Al Jazeera, Le Monde, EL PAÍS, and Rest of World, with BBC RSS and GDELT retained. Each account is pinned to its DID and expected domain handle; reposts, replies, labelled posts, and posts older than 48 hours are omitted. Per-account caps keep one publisher from filling the edition. Source profiles clearly identify their external platform and carry no invented Poplur account or radius.

Video posts use the official Bluesky embed behind a tap-to-load poster. A single decoder lease coordinates playback with local video, and the embed is removed when offscreen, covered by a detail page, backgrounded, or replaced by another video. The original post remains accessible through Poplur Browser. Imported posts show source actions rather than fabricated Poplur reply/repost counts.

The first live ingestion check returned 69 posts, nine accounts, and six videos. These counts change with the live edition. Client parsing, server normalization, source identity rejection, freshness, Unicode hashtags, media URLs, and decoder lifecycle have regression coverage. Following, native Poplur conversations, and additional social providers remain later milestones.
