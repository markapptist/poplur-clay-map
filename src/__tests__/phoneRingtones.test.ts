import { beforeEach, describe, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({ postNativeEvent: vi.fn(() => true) }))

vi.mock('../nativeBridge', () => ({
  isIOSNativeShell: () => true,
  postNativeEvent: bridge.postNativeEvent,
}))

import { startRingtone, stopRingtone } from '../phoneRingtones'

describe('iOS handset ringtone ownership', () => {
  beforeEach(() => {
    bridge.postNativeEvent.mockClear()
    vi.stubGlobal('window', { clearInterval: vi.fn() })
  })

  it('delegates ringing to the native shell instead of starting Web Audio', () => {
    startRingtone('bell')
    expect(bridge.postNativeEvent).toHaveBeenLastCalledWith({
      type: 'phoneRingtone', action: 'start', ringtone: 'bell',
    })
  })

  it('stops the native ringtone when the call is dismissed', () => {
    stopRingtone()
    expect(bridge.postNativeEvent).toHaveBeenCalledWith({ type: 'phoneRingtone', action: 'stop' })
  })
})
