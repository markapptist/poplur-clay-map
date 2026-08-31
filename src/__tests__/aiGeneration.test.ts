import { describe, expect, it } from 'vitest'
import {
  AIGenerationError,
  aiGenerationMessageForStatus,
  aiImageSourceDataURL,
  materializeAIGeneratedImage,
  parseAIGenerationResponse,
  readyWebIdToken,
} from '../aiGeneration'

describe('Poplur AI generation response', () => {
  it('accepts only a completed job with a secure media URL', () => {
    expect(parseAIGenerationResponse({
      job: { id: 'job-1', status: 'completed', outputUrl: 'https://storage.example/result.png', creditsCharged: 12 },
    }, 'image')).toEqual({
      jobId: 'job-1', kind: 'image', status: 'completed', outputUrl: 'https://storage.example/result.png', inlineAsset: null, credits: 12,
    })
  })

  it('does not treat text-only or insecure responses as generated media', () => {
    expect(() => parseAIGenerationResponse({ job: { id: 'job-1', status: 'completed', outputUrl: 'http://bad.example/a.png' } }, 'image'))
      .toThrow(AIGenerationError)
  })

  it('keeps image editing distinct from text-to-image jobs', () => {
    expect(parseAIGenerationResponse({
      job: { id: 'edit-1', status: 'completed', outputUrl: 'https://storage.example/edited.jpg', creditsCharged: 18 },
    }, 'edit')).toMatchObject({ jobId: 'edit-1', kind: 'edit', credits: 18 })
  })

  it('accepts bounded response-only image bytes so native upload never depends on a remote URL', () => {
    expect(parseAIGenerationResponse({
      job: {
        id: 'inline-1',
        status: 'completed',
        outputUrl: null,
        inlineAsset: { mimeType: 'image/png', data: 'AQID' },
      },
    }, 'edit')).toMatchObject({
      jobId: 'inline-1',
      outputUrl: null,
      inlineAsset: { mimeType: 'image/png', data: 'AQID' },
    })
  })

  it('surfaces the nested Cloud Function error instead of replacing it with generic copy', () => {
    expect(aiGenerationMessageForStatus(502, {
      error: { code: 'provider_failed', message: 'The image provider rejected this edit.' },
    })).toBe('The image provider rejected this edit.')
    expect(aiGenerationMessageForStatus(401, {})).toBe('Sign in to use Poplur AI.')
    expect(aiGenerationMessageForStatus(402, {})).toContain('Credits')
    expect(aiGenerationMessageForStatus(429, {})).toContain('busy')
  })

  it('materializes generated image bytes in the data URL contract used by every native bridge', async () => {
    expect(aiImageSourceDataURL({ mimeType: 'image/jpeg', data: 'AQID' }))
      .toBe('data:image/jpeg;base64,AQID')
    await expect(materializeAIGeneratedImage('http://insecure.example/generated.jpg'))
      .rejects.toMatchObject({ name: 'AIGenerationError' })
  })

  it('waits for a persisted browser sign-in before requesting an ID token', async () => {
    let currentUser: { getIdToken: () => Promise<string> } | null = null
    const auth = {
      authStateReady: async () => {
        currentUser = { getIdToken: async () => 'restored-token' }
      },
      get currentUser() { return currentUser },
    }

    await expect(readyWebIdToken(auth, new AbortController().signal))
      .resolves.toBe('restored-token')
  })
})
