import { describe, expect, test } from 'vitest'
import type { DbUserLookup, CheckpointVocabRow } from '../../transport/database/user-lookups/user-lookups-repository'
import {
  applyFrequencyAsymmetryGuard,
  findMweCandidates,
  foldSelectionTokens,
  HOMOGRAPH_RANK_FACTOR,
  matchVocabAgainstSpanLemmas,
  NEVER_DROP_RANK,
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
  occurrences: [],
  directTokenMatch: false,
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

  test('is deliberately NOT digit-hyphen-guarded (broader suppression is conservative)', () => {
    expect(foldSelectionTokens('27-летний', 'ru')).toContain('летний')
  })
})

describe('tokenizeSegments digit-hyphen guard', () => {
  test('the letter part of a digit-hyphen compound never becomes a token', () => {
    const span = tokenizeSegments([{ index: 0, text: 'Пострадали 10-летняя девочка и 27-летний мужчина.' }], 'ru')
    expect(span.foldedTokens.has('летний')).toBe(false)
    expect(span.foldedTokens.has('летняя')).toBe(false)
    expect(span.foldedTokens.has('девочка')).toBe(true)
  })

  test('typographic hyphens (non-breaking U+2011, en dash U+2013) guard the same way', () => {
    const span = tokenizeSegments([{ index: 0, text: 'Ein 27‑jähriger Mann und ein 30–jähriger Mann.' }], 'de')
    expect(span.foldedTokens.has('jähriger')).toBe(false)
    expect(span.foldedTokens.has('mann')).toBe(true)
  })

  test('standalone words and letter-hyphen compounds are unaffected, including at offset 0', () => {
    const span = tokenizeSegments([{ index: 0, text: 'Летний жёлто-синий флаг.' }], 'ru')
    expect(span.foldedTokens.has('летний')).toBe(true)
    expect(span.foldedTokens.has('синий')).toBe(true)
  })
})

describe('tokenizeSegments occurrences', () => {
  test('keeps the cased surface and one occurrence per segment, capped at three', () => {
    const span = tokenizeSegments(
      [
        { index: 0, text: 'При атаке был шум.' },
        { index: 1, text: 'При этом при пожаре тоже.' },
        { index: 2, text: 'При обстреле снова.' },
        { index: 3, text: 'При налете опять.' },
      ],
      'ru'
    )
    const occurrences = span.occurrencesByToken.get('при')!
    expect(occurrences).toHaveLength(3)
    expect(occurrences[0]!.surface).toBe('При')
    expect(occurrences.map((o) => o.segmentIndex)).toEqual([0, 1, 2])
  })

  test('long segments window around the match with ellipses, keeping the surface inside', () => {
    const long = `${'а'.repeat(400)} летели ${'б'.repeat(400)}`
    const span = tokenizeSegments([{ index: 0, text: long }], 'ru')
    const occurrence = span.occurrencesByToken.get('летели')![0]!
    expect(occurrence.context.startsWith('…')).toBe(true)
    expect(occurrence.context.endsWith('…')).toBe(true)
    expect(occurrence.context).toContain('летели')
    expect(occurrence.context.length).toBeLessThan(200)
  })

  test('window cut points snap to word boundaries (no chopped words next to the ellipses)', () => {
    const words = Array.from({ length: 60 }, (_, i) => `слово${i}`)
    words[30] = 'якорь'
    const span = tokenizeSegments([{ index: 0, text: words.join(' ') }], 'ru')
    const occurrence = span.occurrencesByToken.get('якорь')![0]!
    const inner = occurrence.context.replaceAll('…', '')
    // Every word in the window is a complete word from the source text.
    for (const piece of inner.split(' ').filter(Boolean)) {
      expect(words).toContain(piece)
    }
    expect(inner).toContain('якорь')
  })
})

describe('applyFrequencyAsymmetryGuard', () => {
  const ranks = (entries: Record<string, number>) =>
    new Map(Object.entries(entries).map(([lemma, rank]) => [lemma, { rank, freqMass: 0 }]))

  test('drops a dramatically rarer non-identity reading of an ambiguous token', () => {
    // The «при»→«переть» shape: preposition rank 25, verb rank far beyond
    // both the factor threshold and the keep-floor.
    const filtered = applyFrequencyAsymmetryGuard(
      new Map([['при', new Set(['при', 'переть'])]]),
      ranks({ при: 25, переть: 20000 })
    )
    expect(filtered.get('при')).toEqual(new Set(['при']))
  })

  test('an unranked sibling of a ranked common reading is dropped too', () => {
    const filtered = applyFrequencyAsymmetryGuard(new Map([['были', new Set(['быть', 'быль'])]]), ranks({ быть: 10 }))
    expect(filtered.get('были')).toEqual(new Set(['быть']))
  })

  test('identity edges survive regardless of rank (fr «été»)', () => {
    const filtered = applyFrequencyAsymmetryGuard(
      new Map([['été', new Set(['être', 'été'])]]),
      ranks({ être: 5, été: NEVER_DROP_RANK + 5000 })
    )
    expect(filtered.get('été')).toEqual(new Set(['être', 'été']))
  })

  test('the keep-floor protects a common lemma behind a top-rank sibling (fr «suis»)', () => {
    const filtered = applyFrequencyAsymmetryGuard(
      new Map([['suis', new Set(['être', 'suivre'])]]),
      ranks({ être: 5, suivre: 1500 })
    )
    expect(filtered.get('suis')).toEqual(new Set(['être', 'suivre']))
  })

  test('a moderate ratio below the factor keeps both readings (es «como»)', () => {
    const comerRank = 300
    expect(comerRank).toBeLessThan(HOMOGRAPH_RANK_FACTOR * 20)
    const filtered = applyFrequencyAsymmetryGuard(
      new Map([['como', new Set(['como', 'comer'])]]),
      ranks({ como: 20, comer: comerRank })
    )
    expect(filtered.get('como')).toEqual(new Set(['como', 'comer']))
  })

  test('keeps everything when no reading is ranked (unbuilt language / test fixtures)', () => {
    const filtered = applyFrequencyAsymmetryGuard(new Map([['слово', new Set(['слово', 'словить'])]]), new Map())
    expect(filtered.get('слово')).toEqual(new Set(['слово', 'словить']))
  })

  test('single-lemma tokens are untouched even when very rare', () => {
    const filtered = applyFrequencyAsymmetryGuard(new Map([['летели', new Set(['лететь'])]]), ranks({ лететь: 90000 }))
    expect(filtered.get('летели')).toEqual(new Set(['лететь']))
  })
})

describe('matchVocabAgainstSpanLemmas', () => {
  test('matches through particle-stripped headword candidates', () => {
    const row = makeRow(null, { target_language: 'en', headword: 'to run', sense: '' })
    const matched = matchVocabAgainstSpanLemmas({
      vocab: [row],
      spanLemmas: new Set(['run']),
      contextByLemma: new Map([['run', 'I run fast.']]),
      occurrencesByLemma: new Map([['run', [{ surface: 'run', context: 'I run fast.', segmentIndex: 0 }]]]),
      spanTokens: new Set(['run']),
      targetLanguage: 'en',
    })
    expect(matched).toHaveLength(1)
    expect(matched[0]!.matchedLemmas).toEqual(new Set(['run']))
    expect(matched[0]!.contextSegmentText).toBe('I run fast.')
    expect(matched[0]!.occurrences).toEqual([{ surface: 'run', context: 'I run fast.', segmentIndex: 0 }])
  })

  test('an MWE headword does not single-token match', () => {
    const row = makeRow(null, { target_language: 'en', headword: 'run out of', sense: '' })
    const matched = matchVocabAgainstSpanLemmas({
      vocab: [row],
      spanLemmas: new Set(['run', 'out', 'of']),
      contextByLemma: new Map(),
      occurrencesByLemma: new Map(),
      spanTokens: new Set(),
      targetLanguage: 'en',
    })
    expect(matched).toHaveLength(0)
  })

  test('directTokenMatch is true for a verbatim headword, false for an inflected-only match', () => {
    const direct = makeRow(null, { headword: 'согласно', sense: '' })
    const inflected = makeRow(null, { id: '00000000-0000-0000-0000-0000000000ab', headword: 'лететь', sense: '' })
    const matched = matchVocabAgainstSpanLemmas({
      vocab: [direct, inflected],
      // «согласно» is its own token; «лететь» was reached via «летели» only.
      spanLemmas: new Set(['согласно', 'лететь']),
      contextByLemma: new Map(),
      occurrencesByLemma: new Map(),
      spanTokens: new Set(['согласно', 'летели']),
      targetLanguage: 'ru',
    })
    expect(matched.map((m) => m.directTokenMatch)).toEqual([true, false])
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

  test('drops es/pt function words and reduces pronominal parts to the base verb', () => {
    // The Spanish citation convention includes the fused clitic: `darse` can
    // never match token-resolved lemmas (`da`/`dio` → `dar`), so the part
    // reduces to `dar`.
    expect(splitMweContentLemmas('darse cuenta de', 'es')).toEqual(['dar', 'cuenta'])
    expect(splitMweContentLemmas('tener en cuenta', 'es')).toEqual(['tener', 'cuenta'])
    expect(splitMweContentLemmas('dar-se conta de', 'pt')).toEqual(['dar', 'conta'])
    // Ordinary -se words are untouched (only infinitive endings strip).
    expect(splitMweContentLemmas('clase de baile', 'es')).toEqual(['clase', 'baile'])
  })

  test('French splits on hyphens, re-folds interior elided clitics, and drops fr particles', () => {
    // The segmenter never emits hyphenated tokens, so hyphen parts are the
    // matchable units.
    expect(splitMweContentLemmas('peut-être', 'fr')).toEqual(['peut', 'être'])
    // Interior `d'` folds off on the part, matching the folded token `état`.
    expect(splitMweContentLemmas("coup d'état", 'fr')).toEqual(['coup', 'état'])
    expect(splitMweContentLemmas('coup de foudre', 'fr')).toEqual(['coup', 'foudre'])
    expect(splitMweContentLemmas('ne pas savoir', 'fr')).toEqual(['pas', 'savoir'])
    // Leading clitic strips via the fold before splitting.
    expect(splitMweContentLemmas("c'est-à-dire", 'fr')).toEqual(['est', 'dire'])
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
    // MWE candidates skip the backlog confirm pass (the MWE pass owns them)
    // and anchor their evidence on the LONGEST content lemma's occurrence —
    // 'machen' beats 'auf', so a stray early «auf» can't steal the window.
    expect(candidates[0]!.directTokenMatch).toBe(true)
    expect(candidates[0]!.occurrences).toHaveLength(1)
    expect(candidates[0]!.occurrences[0]!.surface).toBe('macht')
    expect(candidates[0]!.occurrences[0]!.context).toContain('macht')
  })

  test('the MWE evidence anchor prefers the distinctive content word over a function word', () => {
    // Russian has no MWE particle list, so «в» stays a content lemma of
    // «в преддверии» — the anchor must still land on «преддверии» even though
    // an unrelated «в» appears earlier in the segment.
    const text = 'Он вошел в дом и заявил о росте числа ударов в преддверии зимы.'
    const ruSpan = tokenizeSegments([{ index: 0, text }], 'ru')
    const mwe = makeRow(null, { target_language: 'ru', headword: 'в преддверии', sense: '' })
    const candidates = findMweCandidates({
      vocab: [mwe],
      span: ruSpan,
      lemmasByToken: new Map(),
      targetLanguage: 'ru',
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.occurrences[0]!.surface).toBe('преддверии')
  })

  test('single-word headwords are never MWE candidates', () => {
    const single = makeRow(null, { target_language: 'de', headword: 'Tür', sense: '' })
    expect(findMweCandidates({ vocab: [single], span, lemmasByToken, targetLanguage: 'de' })).toHaveLength(0)
  })

  test('a French hyphenated headword matches through its hyphen parts', () => {
    const frSpan = tokenizeSegments([{ index: 0, text: 'Il viendra peut-être demain.' }], 'fr')
    const hyphenated = makeRow(null, { target_language: 'fr', headword: 'peut-être', sense: '' })
    const candidates = findMweCandidates({
      vocab: [hyphenated],
      span: frSpan,
      lemmasByToken: new Map(),
      targetLanguage: 'fr',
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.matchedLemmas).toEqual(new Set(['peut', 'être']))
    // Hyphenated headwords stay single-word in non-fr languages.
    const enSpan = tokenizeSegments([{ index: 0, text: 'A passer by walked.' }], 'en')
    const enHyphenated = makeRow(null, { target_language: 'en', headword: 'passer-by', sense: '' })
    expect(
      findMweCandidates({ vocab: [enHyphenated], span: enSpan, lemmasByToken: new Map(), targetLanguage: 'en' })
    ).toHaveLength(0)
  })

  test('a French elided text token matches an elided vocab headword through the fold', () => {
    const frSpan = tokenizeSegments([{ index: 0, text: "L'homme s'appelle Jean." }], 'fr')
    // Token side: l'homme → homme, s'appelle → appelle.
    expect(frSpan.foldedTokens.has('homme')).toBe(true)
    expect(frSpan.foldedTokens.has('appelle')).toBe(true)
    const row = makeRow(null, { target_language: 'fr', headword: "s'appeler", sense: '' })
    const matched = matchVocabAgainstSpanLemmas({
      vocab: [row],
      spanLemmas: new Set(['homme', 'appeler']),
      contextByLemma: new Map([['appeler', "L'homme s'appelle Jean."]]),
      occurrencesByLemma: new Map(),
      spanTokens: frSpan.foldedTokens,
      targetLanguage: 'fr',
    })
    expect(matched).toHaveLength(1)
    expect(matched[0]!.matchedLemmas).toEqual(new Set(['appeler']))
  })
})
