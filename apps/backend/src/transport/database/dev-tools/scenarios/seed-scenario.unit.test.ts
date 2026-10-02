import { describe, expect, test } from 'vitest'
import { exercisePayload, ratingTrail } from './seed-scenario'
import { SCENARIOS } from './scenarios'
import { водопад } from './ru-catalog'

describe('ratingTrail', () => {
  const seed = {
    state: 'review' as const,
    dueInHours: -1,
    stability: 1.2,
    difficulty: 8.6,
    reps: 11,
    lapses: 5,
    lastReviewDaysAgo: 2,
    introducedDaysAgo: 40,
  }

  test('one event per rep, spread from introduction to the last review', () => {
    const trail = ratingTrail(seed)
    expect(trail).toHaveLength(11)
    expect(trail[0]).toMatchObject({ daysAgo: 40, wasIntroduction: true, prevState: null, prevReps: 0 })
    expect(trail.at(-1)).toMatchObject({ daysAgo: 2, rating: 'good', prevReps: 10 })
  })

  test('the lapses are Again ratings that each recover, so the facet ends in review', () => {
    const trail = ratingTrail(seed)
    expect(trail.filter((event) => event.rating === 'again')).toHaveLength(5)
    for (const [index, event] of trail.entries()) {
      if (event.rating === 'again') expect(trail[index + 1]).toMatchObject({ rating: 'good', prevState: 'relearning' })
    }
    expect(trail.at(-1)!.prevLapses).toBe(5)
  })

  test('refuses more lapses than the reps can carry', () => {
    expect(() => ratingTrail({ ...seed, reps: 4, lapses: 2 })).toThrow(/lapses/)
  })
})

describe('exercisePayload', () => {
  test('computes the cloze blank and comprehension term spans from the sentence', () => {
    const cloze = exercisePayload(водопад, 'mc_cloze') as { sentence: string; blankStart: number; blankEnd: number }
    expect(cloze.sentence.slice(cloze.blankStart, cloze.blankEnd)).toBe('водопада')
    const comprehension = exercisePayload(водопад, 'mc_comprehension') as {
      sentence: string
      termStart: number
      termEnd: number
    }
    expect(comprehension.sentence.slice(comprehension.termStart, comprehension.termEnd)).toBe('водопада')
  })

  test('puts the answer among the distractors at its stated index', () => {
    const payload = exercisePayload(водопад, 'mc_cloze') as { options: string[]; answerIndex: number }
    expect(payload.options).toHaveLength(4)
    expect(payload.options[payload.answerIndex]).toBe('водопада')
  })

  test('every banked exercise in every scenario builds', () => {
    for (const spec of SCENARIOS) {
      for (const placed of spec.terms) {
        for (const slot of placed.bank ?? []) {
          if (slot.status !== 'failed') expect(() => exercisePayload(placed.term, slot.type)).not.toThrow()
        }
      }
    }
  })
})
