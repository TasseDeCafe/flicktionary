import { describe, expect, it } from 'vitest'
import { PracticeQueueItemSchema } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { computeIpaSource, toQueueItemDto, toServeOnlyFilter } from './practice-router'
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
    const dto = toQueueItemDto({ type: 'exercise', entry: exerciseEntry })
    expect(dto).toMatchObject({
      type: 'exercise',
      entry: { userLookupId: exerciseEntry.userLookupId, pool: 'recognition', track: 'gate', status: 'ready' },
    })
    expect(() => PracticeQueueItemSchema.parse(dto)).not.toThrow()
  })

  it('a generating placeholder (null exercise/payload) also validates', () => {
    const dto = toQueueItemDto({
      type: 'exercise',
      entry: { ...exerciseEntry, exerciseId: null, exerciseType: null, payload: null, status: 'generating' },
    })
    expect(() => PracticeQueueItemSchema.parse(dto)).not.toThrow()
  })
})

describe('toServeOnlyFilter', () => {
  it('forces autoWarmup off and drops learnExtraCount, keeping the rest of the filter', () => {
    const filter = {
      pools: ['production' as const],
      scope: 'both' as const,
      render: 'both' as const,
      autoWarmup: true,
      includeOptInNew: true,
      learnExtraCount: 5,
    }
    expect(toServeOnlyFilter(filter)).toEqual({ ...filter, autoWarmup: false, learnExtraCount: undefined })
  })
})
