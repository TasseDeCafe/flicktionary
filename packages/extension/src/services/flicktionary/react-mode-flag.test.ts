import { describe, expect, it } from 'vitest'
import type { IndexedSubtitleModel } from '@asbplayer-fork/common'
import { isReactSubtitleEligible } from './react-mode-flag.ts'

// Minimal IndexedSubtitleModel fixtures — the gate only reads `track` and
// `richText`. Everything else is filler to satisfy the type.
const sub = (over: Partial<IndexedSubtitleModel> = {}): IndexedSubtitleModel => ({
  index: 0,
  track: 0,
  text: 'hello world',
  start: 0,
  end: 1000,
  originalStart: 0,
  originalEnd: 1000,
  ...over,
})

// The plain-text, bottom-overlay, word-click-on happy path — eligible.
const eligibleInput = {
  subtitles: [sub({ index: 0 }), sub({ index: 1 })],
  wordClickEnabled: true,
  shouldRenderBottomOverlay: true,
}

describe('isReactSubtitleEligible', () => {
  // This predicate is the migration's safety net: anything it rejects falls
  // back to the legacy DOM path, so each "false" branch must hold.

  it('is eligible for the plain-text single-bottom-track happy path (any site)', () => {
    expect(isReactSubtitleEligible(eligibleInput)).toBe(true)
  })

  it('no longer gates on the host — eligible off YouTube (jsdom default host)', () => {
    // Rendering + gloss are site-agnostic; saving disablement is handled in
    // Binding, not here. So the gate must not consult the page host.
    expect(isReactSubtitleEligible(eligibleInput)).toBe(true)
  })

  it('rejects when word-click is off', () => {
    expect(isReactSubtitleEligible({ ...eligibleInput, wordClickEnabled: false })).toBe(false)
  })

  it('rejects when the bottom overlay is disabled (top-only stays legacy)', () => {
    expect(isReactSubtitleEligible({ ...eligibleInput, shouldRenderBottomOverlay: false })).toBe(false)
  })

  it('accepts multiple tracks (dual/stacked subtitles route per alignment)', () => {
    expect(
      isReactSubtitleEligible({
        ...eligibleInput,
        subtitles: [sub({ index: 0, track: 0 }), sub({ index: 1, track: 1 })],
      })
    ).toBe(true)
  })

  it('rejects when no subtitles are loaded', () => {
    expect(isReactSubtitleEligible({ ...eligibleInput, subtitles: [] })).toBe(false)
  })

  it('rejects rich-text cues', () => {
    expect(
      isReactSubtitleEligible({
        ...eligibleInput,
        subtitles: [sub({ index: 0, richText: '<b>hi</b>' })],
      })
    ).toBe(false)
  })
})
