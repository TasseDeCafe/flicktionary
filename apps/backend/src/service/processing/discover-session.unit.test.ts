import { beforeEach, describe, expect, it, vi } from 'vitest'
import { basicDataPass } from '../../transport/third-party/anthropic/passes/basic-data-pass'
import { runWiktionaryGrounding } from './wiktionary-grounding-runner'
import { getLanguageMode } from '../user-prefs/language-mode'
import { discoverSession } from './discover-session'
import type { ProcessingDependencies } from './discover-session'

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
const segmentId = '00000000-0000-0000-0000-000000000004'

const session = {
  id: sessionId,
  content_source_id: '00000000-0000-0000-0000-0000000000aa',
  text_track_id: '00000000-0000-0000-0000-0000000000bb',
  target_language: 'es',
  native_language: 'fr',
  cefr_level: 'B1',
  context_blob: 'a cached blob',
}

const llmChunk = {
  source: 'llm' as const,
  headword: 'fulano',
  sense: 'so-and-so',
  surfaceForm: 'fulano',
  segmentId,
  translation: 'so-and-so',
  definition: null,
  targetExample: null,
  nativeExample: null,
  belowCefr: false,
}

const strayHighlightChunk = {
  source: 'highlight' as const,
  highlightId: '00000000-0000-0000-0000-0000000000cc',
  headword: 'palabra',
  sense: 'word',
  surfaceForm: 'palabra',
  segmentId,
  translation: 'word',
  definition: null,
  targetExample: null,
  nativeExample: null,
  belowCefr: false,
}

const createDeps = (existingCards: Array<{ highlight_id: string | null }> = []) => {
  const insertCard = vi.fn().mockResolvedValue({ id: 'card-llm' })
  const insertCardForHighlightIdempotent = vi.fn().mockResolvedValue({ id: 'card-hl' })
  const deps = {
    studySessionsRepository: {
      findByIdForUser: vi.fn().mockResolvedValue(session),
      updateContextBlob: vi.fn().mockResolvedValue(true),
      appendProcessingWarning: vi.fn().mockResolvedValue(true),
    },
    contentSourcesRepository: { findById: vi.fn().mockResolvedValue({ title: 'T', language: 'es', type: 'movie' }) },
    textTracksRepository: { findById: vi.fn().mockResolvedValue({ id: session.text_track_id }) },
    textSegmentsRepository: {
      listByTrackId: vi.fn().mockResolvedValue([{ id: segmentId, index: 0, text: 'fulano dijo palabra' }]),
    },
    cardsRepository: {
      listBySessionId: vi.fn().mockResolvedValue(existingCards),
      insertCard,
      insertCardForHighlightIdempotent,
    },
    userLookupsRepository: {
      getLlmHighlightsEnabled: vi.fn(),
      listHeadwordSensesRelevantToTrack: vi.fn().mockResolvedValue({ headwordSenses: [], totalVocabSize: 0 }),
      findPotentialExistingSensesByHeadwords: vi.fn().mockResolvedValue(new Map()),
      findOrCreate: vi.fn().mockResolvedValue({
        id: '00000000-0000-0000-0000-0000000000dd',
        headword: 'fulano',
        translation: null,
        definition: null,
        grounded_at: null,
        grammar_user_edited_at: null,
      }),
      updateContent: vi.fn().mockResolvedValue(undefined),
    },
    usersRepository: { getLlmHighlightsEnabled: vi.fn().mockResolvedValue(true) },
    userTargetLanguagePrefsRepository: {},
    processingTelemetryRepository: { record: vi.fn().mockResolvedValue(undefined) },
    wiktionaryEntriesRepository: {},
  } as unknown as ProcessingDependencies
  return { deps, insertCard, insertCardForHighlightIdempotent }
}

describe('discoverSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getLanguageMode).mockResolvedValue({
      nativeLanguage: 'fr',
      hideTranslationFields: false,
      allowL1Notes: true,
    } as unknown as Awaited<ReturnType<typeof getLanguageMode>>)
    vi.mocked(runWiktionaryGrounding).mockResolvedValue(undefined)
  })

  it('never materializes a source=highlight row, even if the model emits one', async () => {
    vi.mocked(basicDataPass).mockResolvedValue([llmChunk, strayHighlightChunk])
    const { deps, insertCard, insertCardForHighlightIdempotent } = createDeps()

    await discoverSession(sessionId, userId, deps)

    // The llm chunk lands via the plain insert (highlightId null)...
    expect(insertCard).toHaveBeenCalledTimes(1)
    expect(insertCard).toHaveBeenCalledWith(expect.objectContaining({ highlightId: null }))
    // ...and the stray highlight chunk is dropped — no highlight card path.
    expect(insertCardForHighlightIdempotent).not.toHaveBeenCalled()
  })

  it('is a no-op when LLM-suggested cards already exist (idempotent)', async () => {
    const { deps } = createDeps([{ highlight_id: null }])

    await discoverSession(sessionId, userId, deps)

    expect(basicDataPass).not.toHaveBeenCalled()
  })

  it('is a no-op when the user has LLM suggestions disabled', async () => {
    const { deps } = createDeps()
    vi.mocked(deps.usersRepository.getLlmHighlightsEnabled).mockResolvedValue(false)

    await discoverSession(sessionId, userId, deps)

    expect(basicDataPass).not.toHaveBeenCalled()
  })

  it('throws when the discovery pass fails so the job can retry', async () => {
    const { deps } = createDeps()
    const error = new Error('anthropic timeout')
    vi.mocked(basicDataPass).mockRejectedValue(error)

    await expect(discoverSession(sessionId, userId, deps)).rejects.toThrow('anthropic timeout')
    expect(deps.studySessionsRepository.appendProcessingWarning).toHaveBeenCalledWith(
      sessionId,
      userId,
      'Discovery pass failed: anthropic timeout'
    )
  })
})
