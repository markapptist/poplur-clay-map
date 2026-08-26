import { describe, expect, it } from 'vitest'
import {
  resolveUploadReviewRoute,
  UPLOAD_REVIEW_FLOWS,
  type UploadFlowId,
} from '../uploadFlowCatalog'

describe('upload review catalog', () => {
  it('keeps the camera-first decisions in the shipped order', () => {
    expect(UPLOAD_REVIEW_FLOWS.camera.map(step => step.id)).toEqual([
      'capture', 'edit', 'effects', 'finish', 'location', 'publish', 'uploading', 'posted',
    ])
  })

  it('keeps the map-first decisions in the shipped order', () => {
    expect(UPLOAD_REVIEW_FLOWS.map.map(step => step.id)).toEqual([
      'location', 'capture', 'edit', 'effects', 'finish', 'publish', 'uploading', 'posted',
    ])
  })

  for (const flow of Object.keys(UPLOAD_REVIEW_FLOWS) as UploadFlowId[]) {
    it(`${flow} has one unique, ordered instance of every canonical decision`, () => {
      const ids = UPLOAD_REVIEW_FLOWS[flow].map(step => step.id)
      expect(ids).toHaveLength(8)
      expect(new Set(ids).size).toBe(ids.length)
      expect(ids.filter(id => id === 'finish')).toHaveLength(1)
      expect(ids.filter(id => id === 'publish')).toHaveLength(1)
      expect(ids.filter(id => id === 'location')).toHaveLength(1)
      expect(ids).not.toContain('choice')
      expect(ids).not.toContain('video')
    })
  }

  it('normalizes old duplicate deep links without breaking saved review URLs', () => {
    expect(resolveUploadReviewRoute('?flow=camera&screen=choice').screen).toBe('finish')
    expect(resolveUploadReviewRoute('?flow=camera&screen=ai').screen).toBe('finish')
    expect(resolveUploadReviewRoute('?flow=camera&screen=channel-ready').screen).toBe('publish')
    expect(resolveUploadReviewRoute('?flow=camera&screen=location-return').screen).toBe('location')
    expect(resolveUploadReviewRoute('?flow=map&screen=video')).toMatchObject({ screen: 'edit', media: 'video' })
  })
})
