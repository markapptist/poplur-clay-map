// A5: SCAN names things out loud on Android too. The page speaks there by the
// rules iOS's native CameraAIAnnouncer uses, from the ML Kit labels Android's
// shell now sends in iOS's whole-frame shape.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CAMERA_VOICE_COOLDOWN_MS, freshCameraVoice, nextCameraLine } from '../cameraVoice'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const whole = (label: string, confidence: number) => ({ label, confidence, whole: true })
const face = { label: 'person', confidence: 0.95 }

describe('nextCameraLine', () => {
  it('names the strongest whole-frame label, never a located face', () => {
    const state = freshCameraVoice()
    expect(nextCameraLine([face, whole('table', 0.6), whole('coffee_mug', 0.8)], state, 0)).toBe('I see coffee mug.')
    expect(nextCameraLine([face], freshCameraVoice(), 0)).toBeNull()
  })

  it('stays quiet below 0.18', () => {
    expect(nextCameraLine([whole('lamp', 0.17)], freshCameraVoice(), 0)).toBeNull()
    expect(nextCameraLine([whole('lamp', 0.18)], freshCameraVoice(), 0)).toBe('I see lamp.')
  })

  it('waits 2.2 s between lines and never repeats the last one', () => {
    const state = freshCameraVoice()
    expect(nextCameraLine([whole('cup', 0.9)], state, 1_000)).toBe('I see cup.')
    expect(nextCameraLine([whole('plant', 0.9)], state, 1_000 + CAMERA_VOICE_COOLDOWN_MS)).toBeNull()
    expect(nextCameraLine([whole('cup', 0.9)], state, 10_000)).toBeNull()
    expect(nextCameraLine([whole('plant', 0.9)], state, 10_000)).toBe('I see plant.')
  })

  it('starts over when SCAN turns on again', () => {
    const state = freshCameraVoice()
    nextCameraLine([whole('cup', 0.9)], state, 0)
    expect(nextCameraLine([whole('cup', 0.9)], freshCameraVoice(), 100)).toBe('I see cup.')
  })
})

describe('the platforms agree', () => {
  const camera = read('src/Camera.tsx')
  const ios = read('../Poplur2025-iOS/Poplur2025/CameraAIAnnouncer.swift')
  const activity = read('../Poplur2025-Android/app/src/main/java/com/apptists/poplur2025/PostLoginWebActivity.kt')
  const labels = read('../Poplur2025-Android/app/src/main/java/com/apptists/poplur2025/ml/CameraSceneLabels.kt')

  it('the page speaks only in the Android shell, so iOS never says it twice', () => {
    expect(camera).toContain('if (ANDROID_SHELL && scanNarrationRef.current && readCameraAiVoice()) {')
  })

  it('uses iOS\'s cooldown, floor and phrasing', () => {
    expect(ios).toContain('private let mlCooldown: TimeInterval = 2.2')
    expect(ios).toContain('.filter { $0.confidence >= 0.18 }')
    expect(ios).toContain('phrase = "I see \\(labels[0])."')
  })

  it('Android labels frames only while SCAN is on and sends iOS-shaped whole entries', () => {
    expect(activity).toContain('if (type == "cameraControl" && body.optString("control") == "detect") {')
    expect(activity).toContain('val labelsDue = cameraScanOn && now - lastCameraLabelAt >= CAMERA_LABEL_INTERVAL_MS')
    expect(labels).toContain('put("whole", true)')
    expect(labels).toContain('put("primary", !primaryGiven)')
  })
})
