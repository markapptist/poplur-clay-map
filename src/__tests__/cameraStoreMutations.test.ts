import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addCapture,
  clearSelection,
  isSelected,
  listCaptures,
  listSelected,
  removeCaptures,
  selectAll,
  selectedCount,
  setPendingMapPost,
  takePendingMapPost,
  toggleSelected,
} from '../cameraStore'

const shot = (src: string) => addCapture({ kind: 'photo', src })

beforeEach(() => {
  clearSelection()
  removeCaptures(listCaptures().map(c => c.id))
})

describe('capture ids survive deletion', () => {
  // The id used to be derived from captures.length. Deleting one shrank the
  // length, so the next capture was handed an id a previous one already had —
  // and if that id was still selected, the new capture arrived pre-ticked and
  // a delete-selected would take a photo the user never chose.
  it('never reissues an id across add -> remove -> add', () => {
    const seen = new Set<string>()
    for (let round = 0; round < 5; round++) {
      const a = shot(`data:,a${round}`)
      const b = shot(`data:,b${round}`)
      expect(seen.has(a.id)).toBe(false)
      expect(seen.has(b.id)).toBe(false)
      seen.add(a.id); seen.add(b.id)
      removeCaptures([a.id])
    }
  })

  it('does not hand a recycled id a stale tick', () => {
    const first = shot('data:,one')
    toggleSelected(first.id)
    expect(selectedCount()).toBe(1)
    removeCaptures([first.id])
    expect(selectedCount()).toBe(0)
    const next = shot('data:,two')
    expect(next.id).not.toBe(first.id)
    expect(isSelected(next.id)).toBe(false)
  })
})

describe('selection', () => {
  it('selects all, lists, and round-trips through clearSelection', () => {
    const a = shot('data:,a'), b = shot('data:,b'), c = shot('data:,c')
    selectAll([a.id, b.id, c.id])
    expect(selectedCount()).toBe(3)
    expect(listSelected().sort()).toEqual([a.id, b.id, c.id].sort())
    // clearSelection shipped with zero callers; this is its first exercise.
    clearSelection()
    expect(selectedCount()).toBe(0)
    expect(listSelected()).toEqual([])
  })

  it('shrinks when a selected capture is removed', () => {
    const a = shot('data:,a'), b = shot('data:,b')
    selectAll([a.id, b.id])
    removeCaptures([a.id])
    expect(selectedCount()).toBe(1)
    expect(listSelected()).toEqual([b.id])
  })
})

describe('object URLs are revoked only when nothing still points at them', () => {
  it('revokes a blob src no one else holds', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const a = shot('blob:poplur/alone')
    removeCaptures([a.id])
    expect(revoke).toHaveBeenCalledWith('blob:poplur/alone')
    revoke.mockRestore()
  })

  it('leaves a blob src alone while a parked map draft still holds it', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const a = shot('blob:poplur/parked')
    setPendingMapPost({
      media: { kind: 'photo', src: 'blob:poplur/parked' },
      caption: '', channelId: 'live', filterId: 'none', usedAI: false,
    })
    removeCaptures([a.id])
    // Revoking here blanks the composer the user is coming back to.
    expect(revoke).not.toHaveBeenCalled()
    revoke.mockRestore()
    takePendingMapPost()
  })

  it('never revokes a data: url', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const a = shot('data:image/jpeg;base64,zzz')
    removeCaptures([a.id])
    expect(revoke).not.toHaveBeenCalled()
    revoke.mockRestore()
  })

  it('leaves a blob src alone while another capture shares it', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const a = shot('blob:poplur/shared')
    shot('blob:poplur/shared')
    removeCaptures([a.id])
    expect(revoke).not.toHaveBeenCalled()
    revoke.mockRestore()
  })
})
