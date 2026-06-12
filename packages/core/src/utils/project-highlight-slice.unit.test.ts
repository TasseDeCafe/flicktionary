import { describe, expect, it } from 'vitest'
import { projectHighlightSlice } from './project-highlight-slice'

describe('projectHighlightSlice', () => {
  describe('unclamped (web semantics: offsets pass through verbatim)', () => {
    it('projects each relation with the documented formulas', () => {
      const offsets = { startOffset: 3, endOffset: 9, lineLength: 20, clamp: false } as const
      expect(projectHighlightSlice({ relation: 'single', ...offsets })).toEqual({ start: 3, end: 9 })
      expect(projectHighlightSlice({ relation: 'start', ...offsets })).toEqual({ start: 3, end: 20 })
      expect(projectHighlightSlice({ relation: 'middle', ...offsets })).toEqual({ start: 0, end: 20 })
      expect(projectHighlightSlice({ relation: 'end', ...offsets })).toEqual({ start: 0, end: 9 })
    })

    it('passes inverted and over-length offsets through (drift tolerance lives in the caller, not here)', () => {
      expect(
        projectHighlightSlice({ relation: 'single', startOffset: 12, endOffset: 5, lineLength: 10, clamp: false })
      ).toEqual({ start: 12, end: 5 })
      expect(
        projectHighlightSlice({ relation: 'end', startOffset: 0, endOffset: 50, lineLength: 10, clamp: false })
      ).toEqual({ start: 0, end: 50 })
    })

    it("never reads lineLength for 'single'/'end', so callers without the text may pass 0", () => {
      expect(
        projectHighlightSlice({ relation: 'single', startOffset: 3, endOffset: 9, lineLength: 0, clamp: false })
      ).toEqual({ start: 3, end: 9 })
      expect(
        projectHighlightSlice({ relation: 'end', startOffset: 3, endOffset: 9, lineLength: 0, clamp: false })
      ).toEqual({ start: 0, end: 9 })
    })
  })

  describe('clamped (extension semantics: tolerate legacy drifted offsets)', () => {
    it('projects each relation with the documented formulas', () => {
      const offsets = { startOffset: 3, endOffset: 9, lineLength: 20, clamp: true } as const
      expect(projectHighlightSlice({ relation: 'single', ...offsets })).toEqual({ start: 3, end: 9 })
      expect(projectHighlightSlice({ relation: 'start', ...offsets })).toEqual({ start: 3, end: 20 })
      expect(projectHighlightSlice({ relation: 'middle', ...offsets })).toEqual({ start: 0, end: 20 })
      expect(projectHighlightSlice({ relation: 'end', ...offsets })).toEqual({ start: 0, end: 9 })
    })

    it('clamps offsets past the line to its length and negative offsets to 0', () => {
      expect(
        projectHighlightSlice({ relation: 'single', startOffset: 3, endOffset: 50, lineLength: 10, clamp: true })
      ).toEqual({ start: 3, end: 10 })
      expect(
        projectHighlightSlice({ relation: 'single', startOffset: -4, endOffset: 6, lineLength: 10, clamp: true })
      ).toEqual({ start: 0, end: 6 })
    })

    it('drops ranges that are inverted, start past the line, or clamp to zero width', () => {
      expect(
        projectHighlightSlice({ relation: 'single', startOffset: 9, endOffset: 3, lineLength: 20, clamp: true })
      ).toBeNull()
      expect(
        projectHighlightSlice({ relation: 'start', startOffset: 12, endOffset: 15, lineLength: 10, clamp: true })
      ).toBeNull()
      expect(
        projectHighlightSlice({ relation: 'single', startOffset: 5, endOffset: 5, lineLength: 10, clamp: true })
      ).toBeNull()
    })
  })
})
