import { describe, expect, test } from 'vitest'
import type { DbUserLookup, CheckpointVocabRow } from '../../transport/database/user-lookups/user-lookups-repository'
import {
  findMweCandidates,
  foldSelectionTokens,
  matchVocabAgainstSpanLemmas,
  partitionMatches,
  splitMweContentLemmas,
  tokenizeSegments,
  type MatchedVocabRow,
} from './checkpoint-matching'

const makeLookup = (overrides: Partial<DbUserLookup>): DbUserLookup => ({
  id: '00000000-0000-0000-0000-0000000000aa',
  user_id: '00000000-0000-0000-0000-000000000001',
  target_language: 'ru',
  headword: 'стол',
  sense: 'table',
  translation: null,
  definition: null,
  target_example: null,
  native_example: null,
  exploration_extras: {},
  grammar: {},
  grounded_at: null,
  grounding_patch: null,
  grammar_user_edited_at: null,
  first_card_id: null,
  exported_at: null,
  count: 1,
  created_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
  zipf_estimate: null,
  last_encountered_at: '2026-01-01T00:00:00Z',
  encounter_count: 1,
  content_encounter_count: 0,
  last_content_encounter_at: null,
  ...overrides,
})

const NOW = new Date('2026-07-18T12:00:00Z')
const PAST = '2026-07-17T12:00:00Z'
const FUTURE = '2026-07-19T12:00:00Z'

const makeRow = (
  facet: CheckpointVocabRow['facet'],
  lookupOverrides: Partial<DbUserLookup> = {}
): CheckpointVocabRow => ({
  lookup: makeLookup(lookupOverrides),
  facet,
})

const asMatch = (row: CheckpointVocabRow): MatchedVocabRow => ({
  row,
  matchedLemmas: new Set(['стол']),
  contextSegmentText: 'context',
})

describe('tokenizeSegments', () => {
  test('folds tokens, groups by segment, and records first context', () => {
    const span = tokenizeSegments(
      [
        { index: 3, text: 'На столе́ лежит ЁЖ.' },
        { index: 4, text: 'Ёж спит на столе.' },
      ],
      'ru'
    )
    expect(span.foldedTokens.has('столе')).toBe(true)
    expect(span.foldedTokens.has('еж')).toBe(true)
    expect(span.tokensBySegment.get(3)).toEqual(new Set(['на', 'столе', 'лежит', 'еж']))
    expect(span.tokensBySegment.get(4)).toEqual(new Set(['еж', 'спит', 'на', 'столе']))
    // First segment containing the token wins.
    expect(span.contextByToken.get('еж')).toBe('На столе́ лежит ЁЖ.')
  })
})

describe('foldSelectionTokens', () => {
  test('a multi-word selection folds to several tokens', () => {
    expect(foldSelectionTokens('Straßen entlang', 'de')).toEqual(['strassen', 'entlang'])
  })
})

describe('matchVocabAgainstSpanLemmas', () => {
  test('matches through particle-stripped headword candidates', () => {
    const row = makeRow(null, { target_language: 'en', headword: 'to run', sense: '' })
    const matched = matchVocabAgainstSpanLemmas({
      vocab: [row],
      spanLemmas: new Set(['run']),
      contextByLemma: new Map([['run', 'I run fast.']]),
      targetLanguage: 'en',
    })
    expect(matched).toHaveLength(1)
    expect(matched[0]!.matchedLemmas).toEqual(new Set(['run']))
    expect(matched[0]!.contextSegmentText).toBe('I run fast.')
  })

  test('an MWE headword does not single-token match', () => {
    const row = makeRow(null, { target_language: 'en', headword: 'run out of', sense: '' })
    const matched = matchVocabAgainstSpanLemmas({
      vocab: [row],
      spanLemmas: new Set(['run', 'out', 'of']),
      contextByLemma: new Map(),
      targetLanguage: 'en',
    })
    expect(matched).toHaveLength(0)
  })
})

describe('partitionMatches', () => {
  const readyFacet = {
    srs_state: null,
    srs_due: null,
    leech_parked_at: null,
    disabled_at: null,
    data_status: 'ready' as const,
  }

  test('a production-only term (missing recognition facet) is encounter-only', () => {
    const result = partitionMatches([asMatch(makeRow(null))], NOW)
    expect(result.encounterOnly).toHaveLength(1)
    expect(result.creditable).toHaveLength(0)
    expect(result.backlog).toHaveLength(0)
  })

  test('a pending_data facet is encounter-only', () => {
    const result = partitionMatches([asMatch(makeRow({ ...readyFacet, data_status: 'pending_data' }))], NOW)
    expect(result.encounterOnly).toHaveLength(1)
  })

  test('a disabled facet is encounter-only', () => {
    const result = partitionMatches([asMatch(makeRow({ ...readyFacet, disabled_at: PAST }))], NOW)
    expect(result.encounterOnly).toHaveLength(1)
  })

  test('never-introduced facets are backlog, whether unparked or onboarding-parked', () => {
    const unparked = asMatch(makeRow(readyFacet))
    const onboardingParked = asMatch(makeRow({ ...readyFacet, leech_parked_at: PAST }))
    const result = partitionMatches([unparked, onboardingParked], NOW)
    expect(result.backlog).toHaveLength(2)
  })

  test('a leech-parked facet (with SRS history) is excluded from both lanes', () => {
    const result = partitionMatches(
      [asMatch(makeRow({ ...readyFacet, srs_state: 'review', srs_due: PAST, leech_parked_at: PAST }))],
      NOW
    )
    expect(result.excludedLeechParked).toHaveLength(1)
    expect(result.creditable).toHaveLength(0)
    expect(result.backlog).toHaveLength(0)
    expect(result.encounterOnly).toHaveLength(0)
  })

  test('due review and due new facets are creditable; not-due and learning are not', () => {
    const dueReview = asMatch(makeRow({ ...readyFacet, srs_state: 'review', srs_due: PAST }))
    const dueNew = asMatch(makeRow({ ...readyFacet, srs_state: 'new', srs_due: PAST }))
    const notDue = asMatch(makeRow({ ...readyFacet, srs_state: 'review', srs_due: FUTURE }))
    const learning = asMatch(makeRow({ ...readyFacet, srs_state: 'learning', srs_due: PAST }))
    const result = partitionMatches([dueReview, dueNew, notDue, learning], NOW)
    expect(result.creditable).toHaveLength(2)
    expect(result.encounterOnly).toHaveLength(2)
  })
})

describe('splitMweContentLemmas', () => {
  test('folds, splits, and drops per-language particles anywhere', () => {
    expect(splitMweContentLemmas('run OUT of', 'en')).toEqual(['run', 'out', 'of'])
    expect(splitMweContentLemmas('to run to ground', 'en')).toEqual(['run', 'ground'])
    expect(splitMweContentLemmas('sich auf etwas freuen', 'de')).toEqual(['auf', 'etwas', 'freuen'])
    expect(splitMweContentLemmas('идти дождь', 'ru')).toEqual(['идти', 'дождь'])
  })
})

describe('findMweCandidates', () => {
  const span = tokenizeSegments(
    [
      { index: 0, text: 'Er macht die Tür sofort auf.' },
      { index: 1, text: 'Die Tür ist zu.' },
    ],
    'de'
  )
  // "macht" resolves to the lemma "machen" through the (stubbed) resolver map.
  const lemmasByToken = new Map([['macht', new Set(['machen'])]])

  test('a candidate needs every content lemma within ONE segment (inflected via lemma resolution)', () => {
    const separable = makeRow(null, { target_language: 'de', headword: 'auf machen', sense: '' })
    const split = makeRow(null, { target_language: 'de', headword: 'auf zu', sense: '' })
    const candidates = findMweCandidates({ vocab: [separable, split], span, lemmasByToken, targetLanguage: 'de' })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.row.lookup.headword).toBe('auf machen')
    expect(candidates[0]!.contextSegmentText).toBe('Er macht die Tür sofort auf.')
    expect(candidates[0]!.matchedLemmas).toEqual(new Set(['auf', 'machen']))
  })

  test('single-word headwords are never MWE candidates', () => {
    const single = makeRow(null, { target_language: 'de', headword: 'Tür', sense: '' })
    expect(findMweCandidates({ vocab: [single], span, lemmasByToken, targetLanguage: 'de' })).toHaveLength(0)
  })
})
