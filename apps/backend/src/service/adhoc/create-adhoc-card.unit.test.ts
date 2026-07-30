import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyStudyIntent, generateStudyIntentFormData } from '../study-facets/apply-study-intent'
import { materializeBasicDataChunks } from '../processing/materialize-basic-data-chunks'
import { MockAnthropicPasses } from '../../transport/third-party/anthropic/anthropic-passes'
import { createAdhocCard, CreateAdhocCardDependencies } from './create-adhoc-card'

vi.mock('../processing/materialize-basic-data-chunks', () => ({
  materializeBasicDataChunks: vi.fn(),
}))
vi.mock('../processing/wiktionary-grounding-runner', () => ({
  runWiktionaryGrounding: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../user-prefs/language-mode', () => ({
  getLanguageMode: vi.fn().mockResolvedValue({
    nativeLanguage: 'fr',
    hideTranslationFields: false,
    allowL1Notes: true,
  }),
}))
vi.mock('./get-or-create-adhoc-session', () => ({
  getOrCreateAdhocSession: vi.fn().mockResolvedValue({
    session: { id: 'session-1', context_blob: 'blob' },
    track: { id: 'track-1' },
  }),
}))
vi.mock('../study-facets/apply-study-intent', () => ({
  applyStudyIntent: vi.fn().mockResolvedValue({ applied: true, formFacetTargets: [] }),
  generateStudyIntentFormData: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../transport/error-monitoring/error-monitoring', () => ({
  logCustomErrorMessageAndError: vi.fn(),
}))

// Injected through deps.anthropicPasses; tests script it per case with
// vi.mocked(basicDataPass).mockResolvedValue(...).
const basicDataPass = vi.fn()

const userId = '00000000-0000-0000-0000-000000000001'
const lookupId = '00000000-0000-0000-0000-000000000002'
const highlightId = '00000000-0000-0000-0000-000000000003'

const insertedCard = {
  id: 'card-1',
  highlight_id: highlightId,
  user_lookup_id: lookupId,
  surface_form: 'palabras',
}

const createDeps = () => {
  const updateStatus = vi.fn().mockResolvedValue(insertedCard)
  const applyKeepTransition = vi.fn().mockResolvedValue(undefined)
  const insertHighlight = vi.fn().mockResolvedValue({ id: highlightId })
  const deps = {
    anthropicPasses: MockAnthropicPasses({ basicDataPass: basicDataPass as never }),
    textSegmentsRepository: {
      appendSegmentAtomic: vi.fn().mockResolvedValue({ id: 'segment-1', index: 0, text: 'palabras — unas frases' }),
    },
    studySessionsRepository: {},
    highlightsRepository: { insertHighlight },
    cardsRepository: { updateStatus },
    userLookupsRepository: { applyKeepTransition },
    studyFacetsRepository: {},
    usersRepository: {
      setLastTargetLanguage: vi.fn().mockResolvedValue(undefined),
      getIpaDialects: vi.fn().mockResolvedValue({ en: 'ga', es: 'lam', pt: 'br' }),
    },
    userTargetLanguagePrefsRepository: {
      findForLanguage: vi.fn().mockResolvedValue({ cefr_level: 'B1' }),
    },
    processingTelemetryRepository: {},
    wiktionaryEntriesRepository: {},
  } as unknown as CreateAdhocCardDependencies
  return { deps, updateStatus, applyKeepTransition, insertHighlight }
}

describe('createAdhocCard study intent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(basicDataPass).mockResolvedValue([])
    vi.mocked(materializeBasicDataChunks).mockResolvedValue({
      touchedLookups: new Map(),
      insertedCards: [insertedCard],
    } as never)
    vi.mocked(applyStudyIntent).mockResolvedValue({ applied: true, formFacetTargets: [] })
  })

  it('applies the intent BEFORE the keep transition, so the keep-time recognition default is skipped', async () => {
    const { deps, applyKeepTransition } = createDeps()

    await createAdhocCard({
      userId,
      targetLanguage: 'es',
      headword: 'palabra',
      context: 'unas frases',
      studyIntent: { skills: ['meaning_production'], formScope: 'form' },
      deps,
    })

    expect(applyStudyIntent).toHaveBeenCalledWith(
      {
        userLookupId: lookupId,
        userId,
        surfaceForm: 'palabras',
        intent: { skills: ['meaning_production'], formScope: 'form' },
        appliedGuardHighlightId: highlightId,
      },
      expect.anything()
    )
    // Full-set semantics depend on this ordering: the intent's facet rows must
    // exist when applyKeepTransition's row-existence default check runs.
    const intentOrder = vi.mocked(applyStudyIntent).mock.invocationCallOrder[0]!
    const keepOrder = applyKeepTransition.mock.invocationCallOrder[0]!
    expect(intentOrder).toBeLessThan(keepOrder)
  })

  it('generates form data after the keep, with the synthetic segment as the encountered sentence', async () => {
    vi.mocked(applyStudyIntent).mockResolvedValue({
      applied: true,
      formFacetTargets: [{ skill: 'meaning_production', targetForm: 'palabras' }],
    })
    const { deps, applyKeepTransition } = createDeps()

    await createAdhocCard({
      userId,
      targetLanguage: 'es',
      headword: 'palabra',
      context: 'unas frases',
      studyIntent: { skills: ['meaning_production'], formScope: 'form' },
      deps,
    })

    expect(generateStudyIntentFormData).toHaveBeenCalledWith(
      {
        userLookupId: lookupId,
        userId,
        formFacetTargets: [{ skill: 'meaning_production', targetForm: 'palabras' }],
        encounteredSentence: 'palabras — unas frases',
      },
      expect.anything()
    )
    const keepOrder = applyKeepTransition.mock.invocationCallOrder[0]!
    const generateOrder = vi.mocked(generateStudyIntentFormData).mock.invocationCallOrder[0]!
    expect(keepOrder).toBeLessThan(generateOrder)
  })

  it('stores the intent on the synthetic highlight (provenance) and skips everything without one', async () => {
    const { deps, insertHighlight } = createDeps()

    await createAdhocCard({
      userId,
      targetLanguage: 'es',
      headword: 'palabra',
      context: null,
      studyIntent: null,
      deps,
    })

    expect(insertHighlight).toHaveBeenCalledWith(expect.objectContaining({ studyIntent: null }))
    expect(applyStudyIntent).not.toHaveBeenCalled()
    expect(generateStudyIntentFormData).not.toHaveBeenCalled()
  })
})
