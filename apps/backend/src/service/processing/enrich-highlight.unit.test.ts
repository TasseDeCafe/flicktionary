import { beforeEach, describe, expect, it, vi } from 'vitest'
import { basicDataPass } from '../../transport/third-party/anthropic/passes/basic-data-pass'
import { runWiktionaryGrounding } from './wiktionary-grounding-runner'
import { getLanguageMode } from '../user-prefs/language-mode'
import { enrichHighlight } from './enrich-highlight'
import type { ProcessingDependencies } from './processing-dependencies'

vi.mock('../../transport/third-party/anthropic/passes/basic-data-pass', () => ({
  basicDataPass: vi.fn(),
}))
vi.mock('./wiktionary-grounding-runner', () => ({
  runWiktionaryGrounding: vi.fn().mockResolvedValue(undefined),
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
}

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
  const insertCardForHighlightIdempotent = vi.fn().mockResolvedValue({ id: 'card-1' })
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

  it('materializes one pending card + lookup and records highlight_enrichment telemetry', async () => {
    vi.mocked(basicDataPass).mockResolvedValue([highlightChunk])
    const { deps, insertCardForHighlightIdempotent, insertCard, record } = createDeps()

    const outcome = await enrichHighlight({ sessionId, highlightId, userId }, deps)

    expect(outcome).toBe('enriched')
    // Idempotent insert (the partial-unique-index path), never the plain insert.
    expect(insertCardForHighlightIdempotent).toHaveBeenCalledTimes(1)
    expect(insertCardForHighlightIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({ highlightId, status: 'pending', userLookupId: lookupId })
    )
    expect(insertCard).not.toHaveBeenCalled()
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ passName: 'highlight_enrichment' }))
  })

  it('always routes the card through the idempotent insert, so a retry cannot duplicate', async () => {
    vi.mocked(basicDataPass).mockResolvedValue([highlightChunk])
    const { deps, insertCardForHighlightIdempotent, insertCard } = createDeps()

    await enrichHighlight({ sessionId, highlightId, userId }, deps)
    await enrichHighlight({ sessionId, highlightId, userId }, deps)

    expect(insertCardForHighlightIdempotent).toHaveBeenCalledTimes(2)
    expect(insertCard).not.toHaveBeenCalled()
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
