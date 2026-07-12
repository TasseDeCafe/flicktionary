import { describe, expect, it } from 'vitest'
import { PracticeQueueItemSchema } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { computeIpaSource, toPreviewDto, toQueueItemDto } from './practice-router'
import type { DbUserLookupWithFacet } from '../../transport/database/user-lookups/user-lookups-repository'
import type { StrengthenExerciseEntry } from '../../service/practice/exercise-bank'

// Only the fields computeIpaSource reads.
const row = (overrides: Partial<DbUserLookupWithFacet>): DbUserLookupWithFacet =>
  ({
    target_form: '',
    grounded_at: '2026-06-01T00:00:00Z',
    grounding_patch: { ipa: { untagged: '[stɐˈla]' } },
    grammar: { pos: 'noun', ipa: { untagged: '[stɐˈla]' } },
    ...overrides,
  }) as DbUserLookupWithFacet

describe('computeIpaSource', () => {
  it("returns 'wiktionary' when the live grammar.ipa still matches the grounding snapshot", () => {
    expect(computeIpaSource(row({}))).toBe('wiktionary')
  })

  it('never badges a form card — form IPA is generated, not grounded', () => {
    expect(computeIpaSource(row({ target_form: 'стола' }))).toBeNull()
  })

  it('returns null for an ungrounded row', () => {
    expect(computeIpaSource(row({ grounded_at: null }))).toBeNull()
  })

  it('returns null when the grounding snapshot carried no ipa', () => {
    expect(computeIpaSource(row({ grounding_patch: { pos: 'noun' } }))).toBeNull()
    expect(computeIpaSource(row({ grounding_patch: null }))).toBeNull()
  })

  it('drops the claim once the user edits the transcription away from the snapshot', () => {
    expect(computeIpaSource(row({ grammar: { ipa: { untagged: '[drugoj]' } } }))).toBeNull()
  })

  it('tolerates trim-level differences (normalized compare, not byte equality)', () => {
    expect(computeIpaSource(row({ grammar: { ipa: { untagged: ' [stɐˈla] ' } } }))).toBe('wiktionary')
  })
})

describe('toQueueItemDto', () => {
  const flashcardRow = {
    id: '11111111-1111-4111-8111-111111111111',
    headword: 'estrella',
    sense: 'star (sky)',
    translation: 'star',
    definition: null,
    target_example: 'Una estrella brilla.',
    native_example: 'A star shines.',
    grammar: { pos: 'noun' },
    srs_state: 'review',
    target_language: 'es',
    skill: 'meaning_recognition',
    target_form: '',
    payload: null,
    grounded_at: null,
    grounding_patch: null,
  } as unknown as DbUserLookupWithFacet

  const exerciseEntry: StrengthenExerciseEntry = {
    exerciseId: '22222222-2222-4222-8222-222222222222',
    userLookupId: '11111111-1111-4111-8111-111111111111',
    pool: 'recognition',
    headword: 'estrella',
    sense: 'star (sky)',
    translation: 'star',
    definition: null,
    track: 'gate',
    status: 'ready',
    origin: 'onboarding',
    exerciseType: 'mc_cloze',
    payload: {
      type: 'mc_cloze',
      sentence: 'Una __ brilla.',
      blankStart: 4,
      blankEnd: 6,
      options: ['a', 'b', 'c', 'd'],
    },
  }

  it('maps a flashcard item through the review-term DTO and validates against the wire union', () => {
    const dto = toQueueItemDto({ type: 'flashcard', card: flashcardRow })
    expect(dto).toMatchObject({
      type: 'flashcard',
      card: { userLookupId: flashcardRow.id, headword: 'estrella', skill: 'meaning_recognition', targetForm: '' },
    })
    expect(() => PracticeQueueItemSchema.parse(dto)).not.toThrow()
  })

  it('maps an exercise item (stripped payload passes the discriminated union)', () => {
    const dto = toQueueItemDto({
      type: 'exercise',
      entry: exerciseEntry,
      isNewIntroduction: false,
      bypassDailyCap: false,
    })
    expect(dto).toMatchObject({
      type: 'exercise',
      entry: { userLookupId: exerciseEntry.userLookupId, pool: 'recognition', track: 'gate', status: 'ready' },
      isNewIntroduction: false,
      bypassDailyCap: false,
    })
    expect(() => PracticeQueueItemSchema.parse(dto)).not.toThrow()
  })

  it('passes isNewIntroduction through to the wire item', () => {
    const dto = toQueueItemDto({
      type: 'exercise',
      entry: exerciseEntry,
      isNewIntroduction: true,
      bypassDailyCap: true,
    })
    expect(dto).toMatchObject({ type: 'exercise', isNewIntroduction: true, bypassDailyCap: true })
    expect(() => PracticeQueueItemSchema.parse(dto)).not.toThrow()
  })

  it('a generating placeholder (null exercise/payload) also validates', () => {
    const dto = toQueueItemDto({
      type: 'exercise',
      entry: { ...exerciseEntry, exerciseId: null, exerciseType: null, payload: null, status: 'generating' },
      isNewIntroduction: false,
      bypassDailyCap: false,
    })
    expect(() => PracticeQueueItemSchema.parse(dto)).not.toThrow()
  })
})

describe('toPreviewDto', () => {
  const dueRow = (srsState: string | null) => ({ srs_state: srsState }) as DbUserLookupWithFacet

  it('collapses the plan into chip-aligned counts (new/warmup/learning/review)', () => {
    const dto = toPreviewDto({
      dailyBudget: { max: 15, introducedToday: 3, remaining: 12 },
      parkBudget: 10,
      dailyLimitReached: false,
      canLearnExtra: true,
      perPool: [
        {
          pool: 'production',
          dueRows: [dueRow('review'), dueRow('learning')],
          backlogIds: [],
          backlogServedIds: [],
          backlogServedOnboardingCount: 0,
          backlogServedLeechCount: 0,
          introCandidateIds: ['a', 'b'],
          plannedIntroductionCount: 2,
          plannedExtraIntroductionIds: [],
        },
        {
          pool: 'recognition',
          dueRows: [dueRow('review'), dueRow('review'), dueRow('new'), dueRow('relearning')],
          backlogIds: ['p1', 'p2', 'p3'],
          backlogServedIds: ['p1', 'p2', 'p3'],
          backlogServedOnboardingCount: 2,
          backlogServedLeechCount: 1,
          introCandidateIds: ['c'],
          plannedIntroductionCount: 1,
          plannedExtraIntroductionIds: [],
        },
      ],
    })
    expect(dto).toEqual({
      // new = planned introductions across pools, NOT per-pool min() sums.
      counts: { new: 3, warmup: 2, learning: 1 + 1 + 2, review: 1 + 2 },
      dailyLimitReached: false,
      canLearnExtra: true,
      dailyBudget: { max: 15, introducedToday: 3, remaining: 12 },
      plannedIntroductions: { recognition: 1, production: 2 },
    })
  })
})
