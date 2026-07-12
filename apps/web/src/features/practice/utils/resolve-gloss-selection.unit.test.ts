import { describe, expect, it } from 'vitest'
import { resolveGlossSelection, type GlossOwner } from './resolve-gloss-selection'

const SENTENCE = 'She filled the bucket with water.'
const BLANK = { start: 15, end: 21 } // "bucket" — the hidden cloze answer

const owners: Record<string, GlossOwner> = {
  stem: { sourceText: SENTENCE, contextText: SENTENCE, rejectedRanges: [BLANK] },
  'option-0': { sourceText: 'ladder', contextText: SENTENCE, rejectedRanges: [] },
}

const endpoint = (ownerKey: string, wordStart: number, wordEnd: number) => ({ ownerKey, wordStart, wordEnd })

describe('resolveGlossSelection', () => {
  it('resolves a single-word selection with the owner context', () => {
    const resolved = resolveGlossSelection({
      anchor: endpoint('stem', 4, 10),
      end: endpoint('stem', 4, 10),
      owners,
    })
    expect(resolved).toEqual({ text: 'filled', charStart: 4, charEnd: 10, contextText: SENTENCE })
  })

  it('normalizes a reverse drag (anchor after end)', () => {
    const resolved = resolveGlossSelection({
      anchor: endpoint('stem', 27, 32),
      end: endpoint('stem', 22, 26),
      owners,
    })
    expect(resolved).toMatchObject({ text: 'with water', charStart: 22, charEnd: 32 })
  })

  it('rejects a forward drag sweeping across the blank (would surface the hidden answer)', () => {
    expect(
      resolveGlossSelection({ anchor: endpoint('stem', 11, 14), end: endpoint('stem', 22, 26), owners })
    ).toBeNull()
  })

  it('rejects a reverse drag sweeping across the blank', () => {
    expect(
      resolveGlossSelection({ anchor: endpoint('stem', 22, 26), end: endpoint('stem', 11, 14), owners })
    ).toBeNull()
  })

  it('allows a selection ending exactly at the rejected range start', () => {
    const resolved = resolveGlossSelection({
      anchor: endpoint('stem', 11, 14),
      end: endpoint('stem', 11, 14),
      owners,
    })
    expect(resolved).toMatchObject({ text: 'the', charEnd: 14 })
  })

  it('rejects cross-owner drags', () => {
    expect(
      resolveGlossSelection({ anchor: endpoint('stem', 4, 10), end: endpoint('option-0', 0, 6), owners })
    ).toBeNull()
  })

  it('rejects an unknown owner', () => {
    expect(resolveGlossSelection({ anchor: endpoint('ghost', 0, 3), end: endpoint('ghost', 0, 3), owners })).toBeNull()
  })

  it('rejects an empty/whitespace slice', () => {
    expect(resolveGlossSelection({ anchor: endpoint('stem', 3, 3), end: endpoint('stem', 3, 4), owners })).toBeNull()
  })

  it('resolves an option selection against the option label but with the stem as context', () => {
    const resolved = resolveGlossSelection({
      anchor: endpoint('option-0', 0, 6),
      end: endpoint('option-0', 0, 6),
      owners,
    })
    expect(resolved).toEqual({ text: 'ladder', charStart: 0, charEnd: 6, contextText: SENTENCE })
  })
})
