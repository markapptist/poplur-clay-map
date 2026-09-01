import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeLiveMapPost } from '../mapLivePosts'
import { normalizeLiveFeedPost } from '../nativeFeedPosts'
import { profilePostsFromRealtime, profileRecipientUid } from '../profileRealtimePosts'

const profileSource = readFileSync(new URL('../ProfileTwin.tsx', import.meta.url), 'utf8')
const profileCss = readFileSync(new URL('../ProfileTwin.module.css', import.meta.url), 'utf8')
const profileCaptureSource = profileSource.slice(
  profileSource.indexOf('const captureSurface ='),
  profileSource.indexOf('// ── Sharing the open post'),
)
const cameraRollSource = readFileSync(new URL('../CameraRoll.tsx', import.meta.url), 'utf8')
const rnSource = readFileSync(
  new URL('../../../Poplur2025-ReactNative/src/screens/PostLoginHomeWebScreen.tsx', import.meta.url),
  'utf8',
)
const androidSource = readFileSync(
  new URL('../../../Poplur2025-Android/app/src/main/java/com/apptists/poplur2025/PostLoginWebActivity.kt', import.meta.url),
  'utf8',
)
const iosSource = readFileSync(
  new URL('../../../Poplur2025-iOS/Poplur2025/PostLoginHomeWebView.swift', import.meta.url),
  'utf8',
)
const feedSource = readFileSync(new URL('../FeedTwin.tsx', import.meta.url), 'utf8')
const homeSource = readFileSync(new URL('../HomeTwin.tsx', import.meta.url), 'utf8')
const mapSource = readFileSync(new URL('../MapApp.tsx', import.meta.url), 'utf8')

describe('Profile side-button bridge contracts', () => {
  it('keeps the empty Media state free of backend terminology', () => {
    expect(profileSource).toContain("mode === 'liked' ? 'No liked posts yet.' : 'No posts yet.'")
    expect(profileSource).not.toContain('New Firestore posts will appear here live.')
  })

  it('resolves a handle only when it belongs to one stable uid', () => {
    expect(profileRecipientUid([
      { username: '@City.Desk', ownerId: 'uid-city' },
      { username: 'city.desk', ownerId: 'uid-city' },
      { username: '@other', ownerId: 'uid-other' },
    ], '@CITY.DESK')).toBe('uid-city')

    expect(profileRecipientUid([
      { username: '@same', ownerId: 'uid-one' },
      { username: '@same', ownerId: 'uid-two' },
    ], '@same')).toBeNull()
    expect(profileRecipientUid([{ username: '@same' }], '@same')).toBeNull()
  })

  it('sends visiting-profile mail over the acknowledged DM wire', () => {
    expect(profileSource).not.toContain("type: 'sendMessage'")
    expect(profileSource).toMatch(/type: 'sendDM', otherId: recipientId, text, clientMessageId/)
    expect(profileSource).toContain("detail.type === 'poplurDMSent'")
    expect(profileSource).toContain("detail.type === 'poplurDMSendFailed'")
    expect(profileSource).toContain("window.addEventListener('poplur-dm-result', receive)")
    expect(profileSource).toContain('Could not confirm delivery to')
    expect(profileSource).toContain('viewUserId = null')
    expect(profileSource).toContain('explicitRecipientId')
    expect(feedSource).toContain('ownerId: post.ownerId')
    expect(feedSource).toContain('onOpenProfile?.(current.user, current.ownerId)')
    expect(homeSource).toContain('viewUserId={viewingUserId}')
    expect(mapSource).toContain('userId: pin.ownerId')
  })

  it('does not pretend the OS share sheet is a directed Poplur DM', () => {
    const friendHandler = profileSource.slice(
      profileSource.indexOf('const dmFriend ='),
      profileSource.indexOf('const copyLink ='),
    )
    expect(friendHandler).toContain('requestDirectMessage(')
    expect(friendHandler).toContain('void shareOutside(friend.name)')
    expect(friendHandler).not.toContain("type: 'sharePost'")
    expect(profileSource).not.toContain('flashNote(`Sent to ${friend.name}`)')
  })

  it('reports clipboard absence or rejection instead of false success', () => {
    expect(profileSource).toContain("typeof navigator.clipboard?.writeText !== 'function'")
    expect(profileSource).toContain("flashNote(cancelled ? 'Sharing cancelled' : 'Could not share this pop')")
    expect(profileSource).not.toContain('await navigator.clipboard?.writeText(link)')
  })

  it('shares an exact post identity instead of a channel-only route', () => {
    expect(profileSource).toContain('profilePostShareUrl(post)')
    expect(profileSource).toContain('postId: viewerPost.id')
    expect(profileSource).not.toContain("https://poplur.app/p/${post.ch")
    expect(rnSource).toContain('const link = postLink ?? suppliedLink')
    expect(androidSource).toContain('val link = postLink ?: suppliedLink')
    expect(iosSource.indexOf('if let postId = body["postId"]')).toBeLessThan(
      iosSource.indexOf('} else if let suppliedURL'),
    )
  })

  it('projects visited profiles by stable uid before handle fallback', () => {
    expect(profileSource).toContain(
      'profilePostsFromRealtime(realtimePosts, accountUid, viewUser, viewUserId)',
    )
  })

  it('projects one canonical post from Map through Feed into Profile after uid hydration', () => {
    const canonicalPost = {
      userID: 'uid-map-profile',
      mediaURL: 'https://cdn.poplur.test/posts/same-post.jpg',
      mediaType: 'photo',
      username: 'map.profile',
      channelId: 'live',
      audience: 'public',
      status: 'published',
      locationVisibility: 'approximate',
      latitude: 43.6532,
      longitude: -79.3832,
      radius: 1_250,
      createdAtMillis: 123_456,
    }

    const mapPin = normalizeLiveMapPost('same-post', canonicalPost)
    expect(mapPin).toMatchObject({
      id: 'firestore:same-post',
      ownerId: 'uid-map-profile',
      coords: [-79.3832, 43.6532],
      radiusKm: 1.25,
    })

    const feedPost = normalizeLiveFeedPost('same-post', canonicalPost)
    expect(feedPost).toMatchObject({
      id: 'same-post',
      ownerId: 'uid-map-profile',
      locationVisibility: 'approximate',
    })
    expect(feedPost).not.toBeNull()
    expect(profilePostsFromRealtime([feedPost!], null, null)).toEqual([])
    expect(profilePostsFromRealtime([feedPost!], 'uid-map-profile', null)).toEqual([
      expect.objectContaining({
        id: 'same-post',
        video: 'https://cdn.poplur.test/posts/same-post.jpg',
        mediaType: 'photo',
      }),
    ])
  })

  it('carries authenticated profile identity across every native shell', () => {
    expect(iosSource).toContain('payload["uid"] = uid')
    expect(androidSource).toContain('put("uid", user.uid)')
    expect(rnSource).toContain('const uid = auth.currentUser?.uid?.trim()')
    expect(rnSource).toContain('...(uid ? { uid } : {})')
    expect(rnSource).toMatch(
      /const sendProfileToWeb = async[\s\S]*?const uid = auth\.currentUser[\s\S]*?try \{[\s\S]*?await getCurrentProfile\(\)/,
    )
    expect(rnSource).toMatch(
      /catch \(error\)[\s\S]*?dispatchProfileToWeb\(\{ \.\.\.\(uid \? \{ uid \} : \{\}\), business: false \}\)/,
    )
  })

  it('carries stable post ownership across every native feed fallback', () => {
    expect(iosSource).toMatch(
      /data\["userID"\][\s\S]*?data\["userId"\][\s\S]*?data\["ownerId"\][\s\S]*?row\["ownerId"\] = ownerID/,
    )
    expect(androidSource).toMatch(
      /document\.getString\("userID"\)[\s\S]*?document\.getString\("userId"\)[\s\S]*?document\.getString\("ownerId"\)[\s\S]*?put\("ownerId", ownerId\)/,
    )
    expect(rnSource).toMatch(
      /textValue\(data\.userID, 128\)[\s\S]*?textValue\(data\.userId, 128\)[\s\S]*?textValue\(data\.ownerId, 128\)[\s\S]*?row\.ownerId = ownerId/,
    )
  })

  it('keeps an actionable camera-roll shortcut without a native thumbnail reply', () => {
    expect(profileSource).not.toContain('requestMostRecentCameraRollItem')
    expect(profileCaptureSource).toContain('icon="camera.camera_roll"')
    expect(profileCaptureSource).toContain('aria-label="Switch to camera roll"')
    expect(profileCaptureSource).toContain('onActivate={openProfileCameraRoll}')
  })

  it('uses the current shared capture rail instead of the legacy selfie chrome', () => {
    expect(profileCaptureSource).toContain('data-profile-selfie-capture')
    expect(profileCaptureSource).toContain('data-profile-selfie-guide')
    expect(profileCaptureSource).toContain('data-profile-selfie-status')
    expect(profileCaptureSource).toContain('<TabControlRail side={controlSide} label="Profile selfie controls">')
    expect(profileCaptureSource).toContain('<CameraARButton')
    expect(profileCaptureSource).toContain('icon="camera.flip_camera"')
    expect(profileCaptureSource).toContain('icon="camera.camera_roll"')
    expect(profileCaptureSource).toContain('icon="profile.camera"')
    expect(profileCaptureSource).not.toContain('styles.captureSideRail')
    expect(profileCaptureSource).not.toContain('styles.captureFlip')
    expect(profileCaptureSource).not.toContain('styles.captureBar')
    expect(profileCaptureSource).not.toContain('styles.cameraRollThumb')
    expect(profileCaptureSource).not.toContain('<svg')
    expect(profileCss).not.toMatch(/\.captureSideRail\s*\{/)
    expect(profileCss).not.toMatch(/\.captureFlip\s*\{/)
    expect(profileCss).not.toMatch(/\.captureBar\s*\{/)
    expect(profileCss).toContain('var(--header-title-top')
    expect(profileCss).toContain('env(safe-area-inset-bottom')
  })

  it('keeps Profile camera-roll selection on real native media across shells', () => {
    expect(cameraRollSource).toContain('cameraRollDisplayItems(nativeRoll, ROLL, isNativeShell())')
    expect(cameraRollSource).toContain("'poplur-native-camera-roll-selection'")
    expect(cameraRollSource).toContain('mediaKind: requestedMediaKind')
    expect(rnSource).toContain("message.type === 'requestProfileCameraRoll'")
    expect(rnSource).toContain("'poplur-native-camera-roll-selection'")
    expect(rnSource).toContain("pickCapture('library', requestedKind, 'cameraRoll')")
    expect(androidSource).toContain('if (type == "requestProfileCameraRoll")')
    expect(androidSource).toContain('PoplurWebCameraRoll.requestPermission(this@PostLoginWebActivity)')
    expect(iosSource).toContain('if type == "requestProfileCameraRoll"')
    expect(iosSource).toContain('WebCameraRollProvider.push(into: webView)')
  })

  it('gives the React Native shell a real system-share handler', () => {
    expect(rnSource).toContain('Platform, Share, StyleSheet, View')
    expect(rnSource).toContain("message.type === 'sharePost'")
    expect(rnSource).toContain('validatedHttpsUrl(message.link ?? message.url)')
    expect(rnSource).toContain('void Share.share({')
  })

  it('gives the Android shell a validated system-share handler', () => {
    expect(androidSource).toContain('if (type == "sharePost")')
    expect(androidSource).toContain('ifEmpty { body.optString("url").trim() }')
    expect(androidSource).toContain('uri?.scheme.equals("https", ignoreCase = true)')
    expect(androidSource).toContain('Intent(Intent.ACTION_SEND)')
    expect(androidSource).toContain('Intent.createChooser(intent, "Share this pop")')
  })

  it('lets iOS share validated https links for link-only surfaces', () => {
    expect(iosSource).toContain('components.scheme?.lowercased() == "https"')
    expect(iosSource).toContain('components.user == nil')
    expect(iosSource).toContain('} else if let suppliedURL')
  })
})
