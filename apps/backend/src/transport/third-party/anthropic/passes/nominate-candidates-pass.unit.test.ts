import { describe, expect, it } from 'vitest'
import { parseNominatedSpans } from './nominate-candidates-pass'

describe('parseNominatedSpans', () => {
  it('maps a happy-path candidate', () => {
    const raw = [{ segment_id: 'seg-1', surface_form: 'untado', char_start: 4, char_end: 10, reasoning: 'rare' }]
    expect(parseNominatedSpans(raw)).toEqual([{ segmentId: 'seg-1', surfaceForm: 'untado', charStart: 4, charEnd: 10 }])
  })

  it('drops candidates missing a segment id or surface form', () => {
    const raw = [
      { segment_id: '', surface_form: 'x', char_start: 0, char_end: 1 },
      { segment_id: 'seg-1', surface_form: '', char_start: 0, char_end: 1 },
      { segment_id: 'seg-1', surface_form: 'ok', char_start: 0, char_end: 2 },
    ]
    expect(parseNominatedSpans(raw)).toEqual([{ segmentId: 'seg-1', surfaceForm: 'ok', charStart: 0, charEnd: 2 }])
  })

  it('keeps non-numeric offsets as NaN for the caller to reconcile', () => {
    const raw = [{ segment_id: 'seg-1', surface_form: 'ok', char_start: 'x', char_end: null }]
    const [span] = parseNominatedSpans(raw)
    expect(span!.segmentId).toBe('seg-1')
    expect(Number.isNaN(span!.charStart)).toBe(true)
    expect(Number.isNaN(span!.charEnd)).toBe(true)
  })
})
