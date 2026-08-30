import { describe, expect, it } from 'vitest'
import { isARFilterCatalog, isARFilterGrade } from '../arFilterCatalog'
import { faceAccessoryAnchor } from '../faceARLandmarks'
import type { Detection } from '../mlDetect'

const validFilter = {
  id: 'future-filter',
  label: 'Future Filter',
  thumbnail: 'future.png',
  css: 'contrast(1.1)',
  grade: { contrast: 1.1, bloom: 0.2 },
}

describe('streamed AR filter validation', () => {
  it('accepts only finite, recognized Core Image recipe fields', () => {
    expect(isARFilterGrade(validFilter.grade)).toBe(true)
    expect(isARFilterGrade({ contrast: Number.NaN })).toBe(false)
    expect(isARFilterGrade({ contrast: 1.1, unsupported: 2 })).toBe(false)
    expect(isARFilterGrade({})).toBe(false)
  })

  it('rejects catalogs that cannot render safely on an older native binary', () => {
    expect(isARFilterCatalog({
      version: 2,
      filters: [
        { id: 'none', label: 'None', thumbnail: 'none.png', css: 'none' },
        validFilter,
      ],
    })).toBe(true)

    expect(isARFilterCatalog({ version: 2, filters: [{ ...validFilter, grade: undefined }] })).toBe(false)
    expect(isARFilterCatalog({ version: 2.5, filters: [validFilter] })).toBe(false)
    expect(isARFilterCatalog({ version: 2, filters: [validFilter, { ...validFilter }] })).toBe(false)
    expect(isARFilterCatalog({ version: 2, filters: [] })).toBe(false)
  })
})

describe('Vision face landmark anchoring', () => {
  const face: Detection = {
    id: 'face',
    x: 0.2,
    y: 0.3,
    w: 0.4,
    h: 0.5,
    label: 'face',
    confidence: 0.98,
  }

  it('uses the eye line when native Vision supplies it', () => {
    expect(faceAccessoryAnchor({
      ...face,
      landmarks: {
        leftEye: { x: 0.31, y: 0.42 },
        rightEye: { x: 0.49, y: 0.44 },
      },
    })).toEqual({ x: 0.4, y: 0.47 })
  })

  it('keeps the established box centre for absent or malformed landmarks', () => {
    expect(faceAccessoryAnchor(face)).toEqual({ x: 0.4, y: 0.55 })
    expect(faceAccessoryAnchor({
      ...face,
      landmarks: {
        leftEye: { x: Number.NaN, y: 0.42 },
        rightEye: { x: 0.49, y: 0.44 },
      },
    })).toEqual({ x: 0.4, y: 0.55 })
  })
})
