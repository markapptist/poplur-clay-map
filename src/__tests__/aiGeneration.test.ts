import { describe, expect, it } from 'vitest'
import { AIGenerationError, parseAIGenerationResponse } from '../aiGeneration'

describe('Poplur AI generation response', () => {
  it('accepts only a completed job with a secure media URL', () => {
    expect(parseAIGenerationResponse({
      job: { id: 'job-1', status: 'completed', outputUrl: 'https://storage.example/result.png', creditsCharged: 12 },
    }, 'image')).toEqual({
      jobId: 'job-1', kind: 'image', status: 'completed', outputUrl: 'https://storage.example/result.png', credits: 12,
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
})
