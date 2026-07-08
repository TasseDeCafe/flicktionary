import { describe, expect, it } from 'vitest'
import type { SavedHighlightDto } from '@asbplayer-fork/common'
import { buildLineRanges, createSavedHighlightsStore } from './saved-highlights-store'

const highlight = (overrides: Partial<SavedHighlightDto>): SavedHighlightDto => ({
  id: 'h1',
  startSegmentIndex: 5,
  endSegmentIndex: 5,
  startOffset: 3,
  endOffset: 9,
  selectionText: 'word',
  note: null,
  presetTags: [],
  fastGloss: null,
  studyIntent: null,
  chunkId: null,
  noteOnly: false,
  ...overrides,
})

describe('buildLineRanges', () => {
  it('collapses a single-cue highlight to [startOffset, endOffset]', () => {
    expect(buildLineRanges([highlight({})], 5, 20)).toEqual([{ highlightId: 'h1', start: 3, end: 9 }])
  })

  it('returns nothing for lines outside the highlight span', () => {
    expect(buildLineRanges([highlight({})], 4, 20)).toEqual([])
    expect(buildLineRanges([highlight({})], 6, 20)).toEqual([])
  })

  it('paints a cross-cue highlight per cue: tail of the start, whole middles, head of the end', () => {
    const h = highlight({ startSegmentIndex: 5, endSegmentIndex: 7, startOffset: 10, endOffset: 4 })
    expect(buildLineRanges([h], 5, 15)).toEqual([{ highlightId: 'h1', start: 10, end: 15 }])
    expect(buildLineRanges([h], 6, 12)).toEqual([{ highlightId: 'h1', start: 0, end: 12 }])
    expect(buildLineRanges([h], 7, 15)).toEqual([{ highlightId: 'h1', start: 0, end: 4 }])
  })

  it('clamps offsets that exceed the cue text (web-created drift) instead of producing invalid ranges', () => {
    const h = highlight({ startOffset: 3, endOffset: 50 })
    expect(buildLineRanges([h], 5, 10)).toEqual([{ highlightId: 'h1', start: 3, end: 10 }])
  })

  it('drops empty/inverted ranges after clamping', () => {
    const h = highlight({ startOffset: 12, endOffset: 15 })
    expect(buildLineRanges([h], 5, 10)).toEqual([])
  })

  it('emits one range per overlapping highlight', () => {
    const a = highlight({ id: 'a', startOffset: 0, endOffset: 4 })
    const b = highlight({ id: 'b', startOffset: 6, endOffset: 9 })
    expect(buildLineRanges([a, b], 5, 20)).toEqual([
      { highlightId: 'a', start: 0, end: 4 },
      { highlightId: 'b', start: 6, end: 9 },
    ])
  })
})

describe('createSavedHighlightsStore', () => {
  it('add replaces an existing entry by id (no double paint on optimistic add + reload races)', () => {
    const store = createSavedHighlightsStore()
    store.getState().setAll('s1', [highlight({})])
    store.getState().add(highlight({ endOffset: 12 }))
    expect(store.getState().highlights).toHaveLength(1)
    expect(store.getState().highlights[0]!.endOffset).toBe(12)
  })

  it('add backfills the session id on a first save (store loaded before the session existed)', () => {
    const store = createSavedHighlightsStore()
    store.getState().setAll(null, [])
    store.getState().add(highlight({}), 's1')
    expect(store.getState().sessionId).toBe('s1')
    // An add without a session id keeps the existing one.
    store.getState().add(highlight({ id: 'h2' }))
    expect(store.getState().sessionId).toBe('s1')
  })

  it('remove and patchNote target by id', () => {
    const store = createSavedHighlightsStore()
    store.getState().setAll('s1', [highlight({ id: 'a' }), highlight({ id: 'b' })])
    store.getState().patchNote('a', 'hello', ['explain'])
    store.getState().remove('b')
    expect(store.getState().highlights).toEqual([
      expect.objectContaining({ id: 'a', note: 'hello', presetTags: ['explain'] }),
    ])
  })
})
