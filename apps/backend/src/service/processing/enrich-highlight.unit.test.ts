import { beforeEach, describe, expect, it, vi } from 'vitest'
import { basicDataPass } from '../../transport/third-party/anthropic/passes/basic-data-pass'
import { runWiktionaryGrounding } from './wiktionary-grounding-runner'
import { getLanguageMode } from '../user-prefs/language-mode'
import { applyStudyIntent, generateStudyIntentFormData } from '../study-facets/apply-study-intent'
import { autoKeepNeedsDataIfEligible } from '../cards/set-card-status'
import { enrichHighlight } from './enrich-highlight'
import type { ProcessingDependencies } from './processing-dependencies'

vi.mock('../../transport/third-party/anthropic/passes/basic-data-pass', () => ({
  basicDataPass: vi.fn(),
}))
vi.mock('./wiktionary-grounding-runner', () => ({
  runWiktionaryGrounding: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../study-facets/apply-study-intent', () => ({
  applyStudyIntent: vi.fn().mockResolvedValue({ applied: true, formFacetTargets: [] }),
  generateStudyIntentFormData: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../cards/set-card-status', () => ({
  autoKeepNeedsDataIfEligible: vi.fn().mockResolvedValue(null),
}))
vi.mock('../user-prefs/language-mode', () => ({
  getLanguageMode: vi.fn().mockResolvedValue({
    nativeLanguage: 'fr',
    hideTranslationFields: false,
    allowL1Notes: true,
  }),
}))

const userId = '00000000-0000-0000-0000-000000000001'
const sessionId = '00000000-0000-0000-0000-000000000002'
const highlightId = '00000000-0000-0000-0000-000000000003'
const segmentId = '00000000-0000-0000-0000-000000000004'
const lookupId = '00000000-0000-0000-0000-000000000005'

const session = {
  id: sessionId,
  content_source_id: '00000000-0000-0000-0000-0000000000aa',
  text_track_id: '00000000-0000-0000-0000-0000000000bb',
  target_language: 'es',
  native_language: 'fr',
  cefr_level: 'B1',
  context_blob: 'a cached blob',
}

const highlight = {
  id: highlightId,
  study_session_id: sessionId,
  start_segment_id: segmentId,
  selection_text: 'palabra',
  note: null,
  preset_tags: [] as string[],
  study_intent: null as Record<string, unknown> | null,
  study_intent_applied_at: null as string | null,
}

const studyIntent = { skills: ['meaning_production'], formScope: 'form' }

const highlightChunk = {
  source: 'highlight' as const,
  highlightId,
  headword: 'palabra',
  sense: 'word',
  surfaceForm: 'palabra',
  segmentId,
  translation: 'word',
  surfaceTranslation: null,
  definition: null,
  targetExample: null,
  nativeExample: null,
  belowCefr: false,
}

const createDeps = () => {
  const insertCardForHighlightIdempotent = vi.fn().mockResolvedValue({
    id: 'card-1',
    highlight_id: highlightId,
    user_lookup_id: lookupId,
    surface_form: 'palabra',
  })
  const insertCard = vi.fn().mockResolvedValue({ id: 'card-2' })
  const record = vi.fn().mockResolvedValue(undefined)
  const deps = {
    studySessionsRepository: {
      findByIdForUser: vi.fn().mockResolvedValue(session),
      updateContextBlob: vi.fn().mockResolvedValue(true),
    },
    highlightsRepository: {
      findById: vi.fn().mockResolvedValue(highlight),
    },
    contentSourcesRepository: {
      findById: vi.fn().mockResolvedValue({ title: 'T', language: 'es', type: 'movie' }),
    },
    textSegmentsRepository: {
      findById: vi.fn().mockResolvedValue({ id: segmentId, index: 5, text: 'foo palabra bar' }),
      listAroundIndex: vi.fn().mockResolvedValue([{ id: segmentId, index: 5, text: 'foo palabra bar' }]),
      listFirstByTrackId: vi.fn().mockResolvedValue([]),
    },
    cardsRepository: { insertCardForHighlightIdempotent, insertCard },
    userLookupsRepository: {
      findOrCreate: vi.fn().mockResolvedValue({
        id: lookupId,
        headword: 'palabra',
        translation: null,
        definition: null,
        grounded_at: null,
        grammar_user_edited_at: null,
      }),
      updateContent: vi.fn().mockResolvedValue(undefined),
    },
    usersRepository: {},
    userTargetLanguagePrefsRepository: {},
    processingTelemetryRepository: { record },
    wiktionaryEntriesRepository: {},
  } as unknown as ProcessingDependencies
  return { deps, insertCardForHighlightIdempotent, insertCard, record }
}

describe('enrichHighlight', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getLanguageMode).mockResolvedValue({
      nativeLanguage: 'fr',
      hideTranslationFields: false,
      allowL1Notes: true,
    } as unknown as Awaited<ReturnType<typeof getLanguageMode>>)
    vi.mocked(runWiktionaryGrounding).mockResolvedValue(undefined)
  })

  it('materializes one needs_data card + lookup and records highlight_enrichment telemetry', async () => {
    vi.mocked(basicDataPass).mockResolvedValue([highlightChunk])
    const { deps, insertCardForHighlightIdempotent, insertCard, record } = createDeps()

    const outcome = await enrichHighlight({ sessionId, highlightId, userId }, deps)

    expect(outcome).toBe('enriched')
    // Idempotent insert (the partial-unique-index path), never the plain insert.
    expect(insertCardForHighlightIdempotent).toHaveBeenCalledTimes(1)
    expect(insertCardForHighlightIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({ highlightId, status: 'needs_data', userLookupId: lookupId })
    )
    expect(insertCard).not.toHaveBeenCalled()
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ passName: 'highlight_enrichment' }))
    // Auto-keep fires for the materialized card — saving the highlight already
    // committed it, so it keeps automatically.
    expect(autoKeepNeedsDataIfEligible).toHaveBeenCalledWith('card-1', userId, expect.anything())
  })

  it('auto-keeps the card AFTER applying a production-only study intent (no stray recognition facet)', async () => {
    vi.mocked(basicDataPass).mockResolvedValue([highlightChunk])
    vi.mocked(applyStudyIntent).mockResolvedValue({ applied: true, formFacetTargets: [] })
    const { deps } = createDeps()
    vi.mocked(deps.highlightsRepository.findById).mockResolvedValue({
      ...highlight,
      study_intent: { skills: ['meaning_production'], formScope: 'lemma' },
    } as never)

    await enrichHighlight({ sessionId, highlightId, userId }, deps)

    expect(autoKeepNeedsDataIfEligible).toHaveBeenCalledWith('card-1', userId, expect.anything())
    // Finding-1 ordering guard: the intent's facets must be created BEFORE the
    // keep-time recognition default runs (it only force-adds recognition when the
    // term has no facet rows). Keep before intent would give a production-only
    // term a stray recognition facet.
    const intentOrder = vi.mocked(applyStudyIntent).mock.invocationCallOrder[0]
    const keepOrder = vi.mocked(autoKeepNeedsDataIfEligible).mock.invocationCallOrder[0]
    expect(intentOrder).toBeLessThan(keepOrder)
  })

  it('always routes the card through the idempotent insert, so a retry cannot duplicate', async () => {
    vi.mocked(basicDataPass).mockResolvedValue([highlightChunk])
    const { deps, insertCardForHighlightIdempotent, insertCard } = createDeps()

    await enrichHighlight({ sessionId, highlightId, userId }, deps)
    await enrichHighlight({ sessionId, highlightId, userId }, deps)

    expect(insertCardForHighlightIdempotent).toHaveBeenCalledTimes(2)
    expect(insertCard).not.toHaveBeenCalled()
  })

  it('applies a study intent against the highlight card lookup, with the guard id and segment sentence', async () => {
    vi.mocked(basicDataPass).mockResolvedValue([highlightChunk])
    vi.mocked(applyStudyIntent).mockResolvedValue({
      applied: true,
      formFacetTargets: [{ skill: 'meaning_production', targetForm: 'palabra' }],
    })
    const { deps } = createDeps()
    vi.mocked(deps.highlightsRepository.findById).mockResolvedValue({
      ...highlight,
      study_intent: studyIntent,
    } as never)

    const outcome = await enrichHighlight({ sessionId, highlightId, userId }, deps)

    expect(outcome).toBe('enriched')
    expect(applyStudyIntent).toHaveBeenCalledWith(
      {
        userLookupId: lookupId,
        userId,
        surfaceForm: 'palabra',
        intent: studyIntent,
        appliedGuardHighlightId: highlightId,
      },
      expect.anything()
    )
    expect(generateStudyIntentFormData).toHaveBeenCalledWith(
      expect.objectContaining({
        userLookupId: lookupId,
        formFacetTargets: [{ skill: 'meaning_production', targetForm: 'palabra' }],
        encounteredSentence: 'foo palabra bar',
      }),
      expect.anything()
    )
  })

  it('skips intent application when study_intent_applied_at is already stamped', async () => {
    vi.mocked(basicDataPass).mockResolvedValue([highlightChunk])
    const { deps } = createDeps()
    vi.mocked(deps.highlightsRepository.findById).mockResolvedValue({
      ...highlight,
      study_intent: studyIntent,
      study_intent_applied_at: '2026-06-11T00:00:00Z',
    } as never)

    await enrichHighlight({ sessionId, highlightId, userId }, deps)

    expect(applyStudyIntent).not.toHaveBeenCalled()
    expect(generateStudyIntentFormData).not.toHaveBeenCalled()
  })

  it('does not touch the intent machinery when the highlight has none', async () => {
    vi.mocked(basicDataPass).mockResolvedValue([highlightChunk])
    const { deps } = createDeps()

    await enrichHighlight({ sessionId, highlightId, userId }, deps)

    expect(applyStudyIntent).not.toHaveBeenCalled()
    expect(generateStudyIntentFormData).not.toHaveBeenCalled()
  })

  it('skips generation when the intent application lost the guard race', async () => {
    vi.mocked(basicDataPass).mockResolvedValue([highlightChunk])
    vi.mocked(applyStudyIntent).mockResolvedValue({ applied: false, formFacetTargets: [] })
    const { deps } = createDeps()
    vi.mocked(deps.highlightsRepository.findById).mockResolvedValue({
      ...highlight,
      study_intent: studyIntent,
    } as never)

    await enrichHighlight({ sessionId, highlightId, userId }, deps)

    expect(applyStudyIntent).toHaveBeenCalledTimes(1)
    expect(generateStudyIntentFormData).not.toHaveBeenCalled()
  })

  it('cancels (no card) when the highlight was deleted mid-flight', async () => {
    vi.mocked(basicDataPass).mockResolvedValue([highlightChunk])
    const { deps, insertCardForHighlightIdempotent } = createDeps()
    // Exists at the start, gone by the pre-write re-check.
    vi.mocked(deps.highlightsRepository.findById)
      .mockResolvedValueOnce(highlight as never)
      .mockResolvedValueOnce(null as never)

    const outcome = await enrichHighlight({ sessionId, highlightId, userId }, deps)

    expect(outcome).toBe('cancelled')
    expect(insertCardForHighlightIdempotent).not.toHaveBeenCalled()
  })
})
