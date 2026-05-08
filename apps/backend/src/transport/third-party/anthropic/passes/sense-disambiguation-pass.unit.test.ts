import { describe, expect, it } from 'vitest'
import { parseDisambiguationResults } from './sense-disambiguation-pass'

describe('parseDisambiguationResults', () => {
  it('parses a happy-path mix of duplicate and distinct decisions', () => {
    const raw = [
      { candidate_id: 'c0', is_duplicate: true, matched_existing_sense: 'to run a race' },
      { candidate_id: 'c1', is_duplicate: false },
    ]
    expect(parseDisambiguationResults(raw)).toEqual([
      { candidateId: 'c0', isDuplicate: true, matchedExistingSense: 'to run a race' },
      { candidateId: 'c1', isDuplicate: false, matchedExistingSense: null },
    ])
  })

  it('returns an empty list for empty input', () => {
    expect(parseDisambiguationResults([])).toEqual([])
  })

  it('drops decisions missing a candidate_id', () => {
    const raw = [{ is_duplicate: true }, { candidate_id: 'c1', is_duplicate: false }]
    const parsed = parseDisambiguationResults(raw)
    expect(parsed.map((d) => d.candidateId)).toEqual(['c1'])
  })

  it('treats non-true is_duplicate values as false (defensive)', () => {
    const raw = [
      { candidate_id: 'c0', is_duplicate: 'yes' },
      { candidate_id: 'c1' },
      { candidate_id: 'c2', is_duplicate: 1 },
    ]
    const parsed = parseDisambiguationResults(raw)
    expect(parsed.every((d) => d.isDuplicate === false)).toBe(true)
  })

  it('clears matched_existing_sense when not flagged as duplicate', () => {
    const raw = [{ candidate_id: 'c0', is_duplicate: false, matched_existing_sense: 'to flow' }]
    expect(parseDisambiguationResults(raw)[0].matchedExistingSense).toBeNull()
  })

  it('coerces non-string matched_existing_sense to null even when duplicate', () => {
    const raw = [{ candidate_id: 'c0', is_duplicate: true, matched_existing_sense: 42 }]
    expect(parseDisambiguationResults(raw)[0]).toEqual({
      candidateId: 'c0',
      isDuplicate: true,
      matchedExistingSense: null,
    })
  })
})
