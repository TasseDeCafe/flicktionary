import { describe, expect, it } from 'vitest'
import { buildAvailableDifficultyDto, MIN_TRACKED_LEMMAS_FOR_VERDICT } from './session-difficulties'

const computation = {
  expectedCoverage: 0.97,
  unknownLemmas: ['a', 'b', 'c'],
  frequentUnknownLemmas: ['a'],
  savedNotStartedLemmas: ['b'],
  knownLemmas: ['x', 'y'],
}

describe('buildAvailableDifficultyDto', () => {
  it('emits the full verdict at or above the tracked-vocab floor', () => {
    const dto = buildAvailableDifficultyDto(computation, MIN_TRACKED_LEMMAS_FOR_VERDICT)
    expect(dto).toEqual({
      status: 'available',
      expectedCoveragePercent: 97,
      label: 'challenging',
      unknownLemmaCount: 3,
      frequentUnknownCount: 1,
      savedNotStartedCount: 1,
      knownLemmaCount: 2,
    })
  })

  it('suppresses percent and label below the floor but keeps the breakdown counts', () => {
    const dto = buildAvailableDifficultyDto(computation, MIN_TRACKED_LEMMAS_FOR_VERDICT - 1)
    expect(dto.expectedCoveragePercent).toBeNull()
    expect(dto.label).toBeNull()
    expect(dto.unknownLemmaCount).toBe(3)
    expect(dto.knownLemmaCount).toBe(2)
  })

  it('stays null when the computation itself has no coverage, regardless of vocab size', () => {
    const dto = buildAvailableDifficultyDto({ ...computation, expectedCoverage: null }, 1000)
    expect(dto.expectedCoveragePercent).toBeNull()
    expect(dto.label).toBeNull()
  })
})
