import { describe, expect, it } from 'vitest'
import type {
  PracticeQueueItem,
  ReviewTerm,
  StrengthenExerciseEntry,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { mergeComposedPlaceholders, toComposedQueueItem } from './composed-queue-merge'

const exercise = (over: Partial<StrengthenExerciseEntry>): StrengthenExerciseEntry => ({
  exerciseId: null,
  userLookupId: 'u1',
  pool: 'recognition',
  headword: 'w',
  sense: '',
  translation: null,
  definition: null,
  track: 'gate',
  status: 'generating',
  origin: 'onboarding',
  exerciseType: null,
  payload: null,
  ...over,
})

const card = (over: Partial<ReviewTerm>): ReviewTerm =>
  ({
    userLookupId: 'u9',
    headword: 'estrella',
    sense: '',
    translation: null,
    definition: null,
    targetExample: null,
    nativeExample: null,
    grammar: null,
    srsState: 'review',
    targetLanguage: 'es',
    skill: 'meaning_recognition',
    targetForm: '',
    facetPayload: null,
    ipaSource: null,
    ...over,
  }) as ReviewTerm

describe('mergeComposedPlaceholders', () => {
  it('upgrades a not-yet-reached generating exercise in place and never touches flashcards', () => {
    const prev = [
      toComposedQueueItem({ type: 'flashcard', card: card({}) }),
      toComposedQueueItem({ type: 'exercise', entry: exercise({}) }),
    ]
    const fresh: PracticeQueueItem[] = [
      { type: 'flashcard', card: card({ headword: 'changed' }) },
      { type: 'exercise', entry: exercise({ status: 'ready', exerciseId: 'e1', exerciseType: 'mc_cloze' }) },
    ]
    const next = mergeComposedPlaceholders(prev, fresh, 0)
    // Flashcard item untouched (refresh only upgrades exercise placeholders).
    expect(next[0]).toBe(prev[0])
    expect(next[1]).toMatchObject({ type: 'exercise', entry: { status: 'ready', exerciseId: 'e1' } })
  })

  it('keys on (pool, userLookupId) so a both-skills term upgrades per pool', () => {
    const prev = [
      toComposedQueueItem({ type: 'exercise', entry: exercise({ pool: 'production' }) }),
      toComposedQueueItem({ type: 'exercise', entry: exercise({ pool: 'recognition' }) }),
    ]
    const fresh: PracticeQueueItem[] = [
      { type: 'exercise', entry: exercise({ pool: 'recognition', status: 'ready', exerciseId: 'e-rec' }) },
    ]
    const next = mergeComposedPlaceholders(prev, fresh, 0)
    expect(next[0]).toMatchObject({ entry: { pool: 'production', status: 'generating' } })
    expect(next[1]).toMatchObject({ entry: { pool: 'recognition', status: 'ready' } })
  })

  it('never appends fresh items and leaves passed positions untouched (same ref when no change)', () => {
    const prev = [toComposedQueueItem({ type: 'exercise', entry: exercise({}) })]
    const fresh: PracticeQueueItem[] = [
      { type: 'exercise', entry: exercise({ status: 'ready', exerciseId: 'e1' }) },
      { type: 'exercise', entry: exercise({ userLookupId: 'brand-new', status: 'ready', exerciseId: 'e2' }) },
    ]
    // fromIndex past the placeholder → nothing changes, same reference, and
    // the brand-new server-side entry is NOT appended.
    const same = mergeComposedPlaceholders(prev, fresh, 1)
    expect(same).toBe(prev)
    expect(same).toHaveLength(1)
  })
})
