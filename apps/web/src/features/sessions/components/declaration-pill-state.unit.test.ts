import { describe, expect, it } from 'vitest'
import { deriveDeclarationPillState } from './declaration-pill-state'

// A mid-sitting read on a fully-supported session with markable words.
const base = {
  markKnownSupported: true,
  hasSweepableSpan: true,
  sweepPreviewStatus: 'ready' as const,
  markableLemmaCount: 460,
  sessionMarkedCount: 0,
  checkpointSupported: true,
  checkpointSpanNonEmpty: true,
  checkpointPendingCount: 3,
  checkpointBacklogCount: 2,
}

describe('deriveDeclarationPillState', () => {
  it('shows the word count when markable words exist', () => {
    expect(deriveDeclarationPillState(base)).toEqual({ kind: 'sweep', count: 460 })
  })

  it('falls back to checkpoint mode when the word count is 0 but reviews wait', () => {
    expect(deriveDeclarationPillState({ ...base, markableLemmaCount: 0 })).toEqual({
      kind: 'checkpoint',
      pendingCount: 3,
    })
  })

  it('keeps checkpoint mode for backlog-only spans (pending 0)', () => {
    expect(deriveDeclarationPillState({ ...base, markableLemmaCount: 0, checkpointPendingCount: 0 })).toEqual({
      kind: 'checkpoint',
      pendingCount: 0,
    })
  })

  it('shows checkpoint mode when the sweep is unsupported (profile pending / adhoc / lesson)', () => {
    expect(deriveDeclarationPillState({ ...base, markKnownSupported: false })).toEqual({
      kind: 'checkpoint',
      pendingCount: 3,
    })
  })

  it('never hides checkpoint access while the sweep preview is still loading', () => {
    expect(deriveDeclarationPillState({ ...base, sweepPreviewStatus: null })).toEqual({
      kind: 'checkpoint',
      pendingCount: 3,
    })
  })

  it('shows all-known once everything read has been marked by this session', () => {
    expect(
      deriveDeclarationPillState({
        ...base,
        markableLemmaCount: 0,
        sessionMarkedCount: 460,
        checkpointPendingCount: 0,
        checkpointBacklogCount: 0,
      })
    ).toEqual({ kind: 'allKnown' })
  })

  it('dims at a genuine zero (nothing marked yet, nothing to collect)', () => {
    expect(
      deriveDeclarationPillState({
        ...base,
        markableLemmaCount: 0,
        checkpointPendingCount: 0,
        checkpointBacklogCount: 0,
      })
    ).toEqual({ kind: 'dimmed' })
  })

  it('dims before any read exists', () => {
    expect(deriveDeclarationPillState({ ...base, hasSweepableSpan: false, checkpointSpanNonEmpty: false })).toEqual({
      kind: 'dimmed',
    })
  })

  it('hides only when both systems are unsupported', () => {
    expect(deriveDeclarationPillState({ ...base, markKnownSupported: false, checkpointSupported: false })).toEqual({
      kind: 'hidden',
    })
  })
})
