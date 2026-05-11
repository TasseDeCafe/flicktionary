import { describe, expect, it } from 'vitest'
import { applyRating } from './fsrs'
import type { DbUserLookup } from '../../transport/database/user-lookups/user-lookups-repository'

const newRow: DbUserLookup = {
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
  srs_state: null,
  srs_due: null,
  srs_stability: null,
  srs_difficulty: null,
  srs_last_review: null,
  srs_reps: 0,
  srs_lapses: 0,
  added_to_practice_at: null,
  created_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
}

const reviewRow: DbUserLookup = {
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
  it("transitions a never-reviewed row out of the 'new' seed on first rating", () => {
    const now = new Date('2026-05-05T12:00:00Z')
    const result = applyRating(newRow, 'good', now)
    expect(result.state).not.toBe('new')
    expect(result.due.getTime()).toBeGreaterThan(now.getTime())
    expect(result.reps).toBeGreaterThan(0)
    expect(result.lastReview.getTime()).toBe(now.getTime())
  })

  it("'again' on a review-state row reduces stability and increments lapses", () => {
    const now = new Date('2026-05-05T12:00:00Z')
    const result = applyRating(reviewRow, 'again', now)
    expect(result.lapses).toBeGreaterThan(reviewRow.srs_lapses)
    // 'again' moves a review row into relearning.
    expect(result.state).toBe('relearning')
    expect(result.stability).toBeLessThan(reviewRow.srs_stability ?? Infinity)
  })

  it("'easy' on a review row schedules a longer due-date than 'good'", () => {
    const now = new Date('2026-05-05T12:00:00Z')
    const easy = applyRating(reviewRow, 'easy', now)
    const good = applyRating(reviewRow, 'good', now)
    expect(easy.due.getTime()).toBeGreaterThan(good.due.getTime())
  })
})
