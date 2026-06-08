import { describe, expect, it } from 'vitest'
import { applyRating, softReentryResult } from './fsrs'
import { SOFT_REENTRY_DIFFICULTY, SOFT_REENTRY_STABILITY } from './leech-config'
import type { DbUserLookupWithFacet } from '../../transport/database/user-lookups/user-lookups-repository'

const newRow: DbUserLookupWithFacet = {
  id: '00000000-0000-0000-0000-0000000000aa',
  user_id: '00000000-0000-0000-0000-000000000001',
  target_language: 'es',
  headword: 'aprovechar',
  sense: 'to take advantage of',
  translation: null,
  definition: null,
  target_example: null,
  native_example: null,
  exploration_extras: {},
  grammar: {},
  grounded_at: null,
  grammar_user_edited_at: null,
  first_card_id: null,
  exported_at: null,
  count: 1,
  learning_mode: 'passive',
  created_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
  // Facet (citation recognition) state.
  skill: 'meaning_recognition',
  target_form: '',
  srs_state: null,
  srs_due: null,
  srs_stability: null,
  srs_difficulty: null,
  srs_last_review: null,
  srs_reps: 0,
  srs_lapses: 0,
  leech_parked_at: null,
  leech_rehab_correct_days: 0,
  leech_rehab_last_correct_on: null,
  introduced_at: null,
}

const reviewRow: DbUserLookupWithFacet = {
  ...newRow,
  srs_state: 'review',
  srs_due: '2026-05-10T00:00:00Z',
  srs_stability: 10,
  srs_difficulty: 5,
  srs_last_review: '2026-05-01T00:00:00Z',
  srs_reps: 3,
  srs_lapses: 0,
}

describe('applyRating', () => {
  it("transitions a never-reviewed facet out of the 'new' seed on first rating", () => {
    const now = new Date('2026-05-05T12:00:00Z')
    const result = applyRating(newRow, 'good', now)
    expect(result.state).not.toBe('new')
    expect(result.due.getTime()).toBeGreaterThan(now.getTime())
    expect(result.reps).toBeGreaterThan(0)
    expect(result.lastReview.getTime()).toBe(now.getTime())
  })

  it("'again' on a review-state facet reduces stability and increments lapses", () => {
    const now = new Date('2026-05-05T12:00:00Z')
    const result = applyRating(reviewRow, 'again', now)
    expect(result.lapses).toBeGreaterThan(reviewRow.srs_lapses)
    // 'again' moves a review row into relearning.
    expect(result.state).toBe('relearning')
    expect(result.stability).toBeLessThan(reviewRow.srs_stability ?? Infinity)
  })

  it("'easy' on a review facet schedules a longer due-date than 'good'", () => {
    const now = new Date('2026-05-05T12:00:00Z')
    const easy = applyRating(reviewRow, 'easy', now)
    const good = applyRating(reviewRow, 'good', now)
    expect(easy.due.getTime()).toBeGreaterThan(good.due.getTime())
  })

  describe('next-day floor (recognition straggler clamp)', () => {
    const DAY_MS = 24 * 60 * 60 * 1000
    const now = new Date('2026-05-05T12:00:00Z')
    const floor = now.getTime() + DAY_MS

    it.each(['good', 'hard', 'easy'] as const)(
      "clamps a recognition '%s' rating on a new card to at least +24h",
      (rating) => {
        const result = applyRating(newRow, rating, now)
        // Without the clamp, FSRS would schedule these intraday (minutes away).
        expect(result.due.getTime()).toBeGreaterThanOrEqual(floor)
      }
    )

    it("does NOT clamp a recognition 'again' rating — misses stay due soon", () => {
      const result = applyRating(newRow, 'again', now)
      expect(result.due.getTime()).toBeLessThan(floor)
    })

    it('does NOT clamp a production facet — intraday drilling is preserved', () => {
      const productionRow: DbUserLookupWithFacet = { ...newRow, skill: 'meaning_production' }
      const result = applyRating(productionRow, 'good', now)
      expect(result.due.getTime()).toBeLessThan(floor)
    })

    it('produces a sane interval on a second rating across the floor', () => {
      // First rating: clamped to the +24h floor.
      const first = applyRating(newRow, 'good', now)
      expect(first.due.getTime()).toBe(floor)

      // Persist the clamped card and rate again ~24h later. Clamping the first
      // due shifts the elapsed time FSRS sees vs native scheduling; confirm the
      // result is still a valid future interval (no degenerate/zero/past due).
      const persisted: DbUserLookupWithFacet = {
        ...newRow,
        srs_state: first.state,
        srs_due: first.due.toISOString(),
        srs_stability: first.stability,
        srs_difficulty: first.difficulty,
        srs_last_review: first.lastReview.toISOString(),
        srs_reps: first.reps,
        srs_lapses: first.lapses,
      }
      const now2 = new Date(floor)
      const second = applyRating(persisted, 'good', now2)
      expect(second.due.getTime()).toBeGreaterThanOrEqual(now2.getTime() + DAY_MS)
      expect(Number.isFinite(second.due.getTime())).toBe(true)
      expect(second.reps).toBeGreaterThan(first.reps)
    })
  })
})

describe('softReentryResult', () => {
  it('returns the softened schedule for a graduating leech (no reps/lapses — those stay untouched)', () => {
    const now = new Date('2026-06-04T12:00:00Z')
    const result = softReentryResult(now)
    expect(result.state).toBe('review')
    expect(result.due.getTime()).toBe(now.getTime() + 24 * 60 * 60 * 1000)
    expect(result.stability).toBe(SOFT_REENTRY_STABILITY)
    expect(result.difficulty).toBe(SOFT_REENTRY_DIFFICULTY)
    expect(result.lastReview.getTime()).toBe(now.getTime())
    // The result deliberately has no reps/lapses fields: unparkAndSoftReentry
    // preserves history and the parked_at flag is the re-park gate.
    expect('reps' in result).toBe(false)
    expect('lapses' in result).toBe(false)
  })
})
