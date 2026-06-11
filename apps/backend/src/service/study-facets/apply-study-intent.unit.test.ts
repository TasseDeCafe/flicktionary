import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyStudyIntent, generateStudyIntentFormData, ApplyStudyIntentDeps } from './apply-study-intent'
import { generateFormFacetData, GenerateFormFacetDataDeps } from './generate-form-facet-data'

vi.mock('./generate-form-facet-data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./generate-form-facet-data')>()),
  generateFormFacetData: vi.fn(),
}))
vi.mock('../../transport/third-party/sentry/error-monitoring', () => ({
  logCustomErrorMessageAndError: vi.fn(),
}))

const userId = '00000000-0000-0000-0000-000000000001'
const lookupId = '00000000-0000-0000-0000-000000000002'
const highlightId = '00000000-0000-0000-0000-000000000003'

const lookup = {
  id: lookupId,
  headword: 'palabra',
  target_language: 'es',
  // Displayable untagged IPA, so an enabled pronunciation facet survives the
  // reconcile by default.
  grammar: { ipa: { untagged: 'paˈlaβɾa' } },
}

const createDeps = (overrides?: { lookup?: unknown; applyResult?: boolean }) => {
  const findByIdForUser = vi.fn().mockResolvedValue(overrides?.lookup === undefined ? lookup : overrides.lookup)
  const deleteFacet = vi.fn().mockResolvedValue(undefined)
  const applyStudyIntentFacets = vi.fn().mockResolvedValue(overrides?.applyResult ?? true)
  const deps = {
    userLookupsRepository: { findByIdForUser, deleteFacet },
    studyFacetsRepository: { applyStudyIntentFacets },
  } as unknown as ApplyStudyIntentDeps
  return { deps, findByIdForUser, deleteFacet, applyStudyIntentFacets }
}

describe('applyStudyIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates exactly the listed skills as citation facets — full-set, no implied recognition', async () => {
    const { deps, applyStudyIntentFacets } = createDeps()

    const result = await applyStudyIntent(
      {
        userLookupId: lookupId,
        userId,
        surfaceForm: 'palabra',
        intent: { skills: ['meaning_production'], formScope: 'lemma' },
      },
      deps
    )

    expect(result.applied).toBe(true)
    expect(result.formFacetTargets).toEqual([])
    expect(applyStudyIntentFacets).toHaveBeenCalledWith({
      userLookupId: lookupId,
      facets: [{ userLookupId: lookupId, skill: 'meaning_production', targetForm: '' }],
      guardHighlightId: undefined,
    })
  })

  it("formScope 'both' adds pending_data form facets for the meaning skills, keyed on the normalized form", async () => {
    const { deps, applyStudyIntentFacets } = createDeps()

    const result = await applyStudyIntent(
      {
        userLookupId: lookupId,
        userId,
        surfaceForm: 'Palabras ',
        intent: { skills: ['meaning_recognition', 'meaning_production'], formScope: 'both' },
        appliedGuardHighlightId: highlightId,
      },
      deps
    )

    expect(result.formFacetTargets).toEqual([
      { skill: 'meaning_recognition', targetForm: 'palabras' },
      { skill: 'meaning_production', targetForm: 'palabras' },
    ])
    expect(applyStudyIntentFacets).toHaveBeenCalledWith({
      userLookupId: lookupId,
      guardHighlightId: highlightId,
      facets: [
        { userLookupId: lookupId, skill: 'meaning_recognition', targetForm: '' },
        { userLookupId: lookupId, skill: 'meaning_production', targetForm: '' },
        {
          userLookupId: lookupId,
          skill: 'meaning_recognition',
          targetForm: 'palabras',
          dataStatus: 'pending_data',
          source: 'highlight',
          // The payload keeps the display form (trim/case via the key only).
          payload: { form: 'Palabras ' },
        },
        {
          userLookupId: lookupId,
          skill: 'meaning_production',
          targetForm: 'palabras',
          dataStatus: 'pending_data',
          source: 'highlight',
          payload: { form: 'Palabras ' },
        },
      ],
    })
  })

  it('collapses to lemma-only when the surface IS the headword (case/stress variants included)', async () => {
    const { deps, applyStudyIntentFacets } = createDeps()

    const result = await applyStudyIntent(
      {
        userLookupId: lookupId,
        userId,
        surfaceForm: 'Palabra',
        intent: { skills: ['meaning_recognition'], formScope: 'both' },
      },
      deps
    )

    expect(result.formFacetTargets).toEqual([])
    expect(applyStudyIntentFacets).toHaveBeenCalledWith(
      expect.objectContaining({
        facets: [{ userLookupId: lookupId, skill: 'meaning_recognition', targetForm: '' }],
      })
    )
  })

  it('creates a pronunciation form facet alongside the meaning skills (born pending_data)', async () => {
    const { deps, applyStudyIntentFacets } = createDeps()

    const result = await applyStudyIntent(
      {
        userLookupId: lookupId,
        userId,
        surfaceForm: 'palabras',
        intent: { skills: ['pronunciation', 'meaning_recognition'], formScope: 'both' },
      },
      deps
    )

    expect(result.formFacetTargets).toEqual([
      { skill: 'pronunciation', targetForm: 'palabras' },
      { skill: 'meaning_recognition', targetForm: 'palabras' },
    ])
    const facets = applyStudyIntentFacets.mock.calls[0]![0].facets as Array<{ skill: string; targetForm: string }>
    expect(facets.filter((f) => f.skill === 'pronunciation')).toEqual([
      { userLookupId: lookupId, skill: 'pronunciation', targetForm: '' },
      {
        userLookupId: lookupId,
        skill: 'pronunciation',
        targetForm: 'palabras',
        dataStatus: 'pending_data',
        source: 'highlight',
        payload: { form: 'palabras' },
      },
    ])
  })

  it('reconciles an enabled pronunciation facet away when the term has no displayable IPA', async () => {
    const { deps, deleteFacet } = createDeps({ lookup: { ...lookup, grammar: {} } })

    await applyStudyIntent(
      {
        userLookupId: lookupId,
        userId,
        surfaceForm: 'palabra',
        intent: { skills: ['pronunciation'], formScope: 'lemma' },
      },
      deps
    )

    expect(deleteFacet).toHaveBeenCalledWith({ userLookupId: lookupId, skill: 'pronunciation', targetForm: '' })
  })

  it('keeps the pronunciation facet when IPA is displayable', async () => {
    const { deps, deleteFacet } = createDeps()

    await applyStudyIntent(
      {
        userLookupId: lookupId,
        userId,
        surfaceForm: 'palabra',
        intent: { skills: ['pronunciation'], formScope: 'lemma' },
      },
      deps
    )

    expect(deleteFacet).not.toHaveBeenCalled()
  })

  it('no-ops (applied: false) when the guard lost — and skips the reconcile', async () => {
    const { deps, deleteFacet } = createDeps({ lookup: { ...lookup, grammar: {} }, applyResult: false })

    const result = await applyStudyIntent(
      {
        userLookupId: lookupId,
        userId,
        surfaceForm: 'palabras',
        intent: { skills: ['pronunciation'], formScope: 'both' },
        appliedGuardHighlightId: highlightId,
      },
      deps
    )

    expect(result).toEqual({ applied: false, formFacetTargets: [] })
    expect(deleteFacet).not.toHaveBeenCalled()
  })

  it('no-ops when the term does not exist / is not owned', async () => {
    const { deps, applyStudyIntentFacets } = createDeps({ lookup: null })

    const result = await applyStudyIntent(
      {
        userLookupId: lookupId,
        userId,
        surfaceForm: 'palabra',
        intent: { skills: ['meaning_recognition'], formScope: 'lemma' },
      },
      deps
    )

    expect(result).toEqual({ applied: false, formFacetTargets: [] })
    expect(applyStudyIntentFacets).not.toHaveBeenCalled()
  })
})

describe('generateStudyIntentFormData', () => {
  const setFacetPayload = vi.fn().mockResolvedValue(undefined)
  const listFacetsForChunk = vi.fn()
  // Target language source for the pronunciation sibling guard's
  // displayable-IPA check.
  const getChunkRowForUser = vi
    .fn()
    .mockResolvedValue({ id: lookupId, headword: 'palabra', translation: 'word', targetLanguage: 'es' })
  const deps = {
    userLookupsRepository: { listFacetsForChunk, setFacetPayload, getChunkRowForUser },
    usersRepository: {},
    userTargetLanguagePrefsRepository: {},
  } as unknown as GenerateFormFacetDataDeps

  const pendingFacet = (skill: string, targetForm: string, dataStatus = 'pending_data') => ({
    skill,
    targetForm,
    enabled: true,
    dataStatus,
    srsState: null,
    payload: { form: targetForm },
    generatedPayload: null,
    source: null,
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips facets that are no longer pending (re-encounter must not regenerate)', async () => {
    listFacetsForChunk.mockResolvedValue([pendingFacet('meaning_recognition', 'palabras', 'ready')])

    await generateStudyIntentFormData(
      {
        userLookupId: lookupId,
        userId,
        formFacetTargets: [{ skill: 'meaning_recognition', targetForm: 'palabras' }],
        encounteredSentence: 'unas palabras nuevas',
      },
      deps
    )

    expect(generateFormFacetData).not.toHaveBeenCalled()
  })

  it('generates once per form and copies the payload to the sibling skill', async () => {
    const generatedPayload = { form: 'palabras', translation: 'words' }
    listFacetsForChunk
      .mockResolvedValueOnce([
        pendingFacet('meaning_recognition', 'palabras'),
        pendingFacet('meaning_production', 'palabras'),
      ])
      .mockResolvedValueOnce([
        { ...pendingFacet('meaning_recognition', 'palabras', 'ready'), payload: generatedPayload, generatedPayload },
        pendingFacet('meaning_production', 'palabras'),
      ])
    vi.mocked(generateFormFacetData).mockResolvedValue('generated')

    await generateStudyIntentFormData(
      {
        userLookupId: lookupId,
        userId,
        formFacetTargets: [
          { skill: 'meaning_recognition', targetForm: 'palabras' },
          { skill: 'meaning_production', targetForm: 'palabras' },
        ],
        encounteredSentence: 'unas palabras nuevas',
      },
      deps
    )

    expect(generateFormFacetData).toHaveBeenCalledTimes(1)
    expect(generateFormFacetData).toHaveBeenCalledWith(
      {
        chunkId: lookupId,
        userId,
        skill: 'meaning_recognition',
        targetForm: 'palabras',
        encounteredSentence: 'unas palabras nuevas',
      },
      deps
    )
    expect(setFacetPayload).toHaveBeenCalledTimes(1)
    expect(setFacetPayload).toHaveBeenCalledWith({
      userLookupId: lookupId,
      userId,
      skill: 'meaning_production',
      targetForm: 'palabras',
      payload: generatedPayload,
      generatedPayload,
    })
  })

  it('generates via a meaning skill first even when pronunciation is listed first, and copies to the pronunciation sibling only with displayable form IPA', async () => {
    const generatedPayload = {
      form: 'palabras',
      translation: 'words',
      grammar: { pos: 'noun', ipa: { untagged: 'paˈlaβɾas' } },
    }
    listFacetsForChunk
      .mockResolvedValueOnce([
        pendingFacet('pronunciation', 'palabras'),
        pendingFacet('meaning_recognition', 'palabras'),
      ])
      .mockResolvedValueOnce([
        pendingFacet('pronunciation', 'palabras'),
        { ...pendingFacet('meaning_recognition', 'palabras', 'ready'), payload: generatedPayload, generatedPayload },
      ])
    vi.mocked(generateFormFacetData).mockResolvedValue('generated')

    await generateStudyIntentFormData(
      {
        userLookupId: lookupId,
        userId,
        formFacetTargets: [
          { skill: 'pronunciation', targetForm: 'palabras' },
          { skill: 'meaning_recognition', targetForm: 'palabras' },
        ],
        encounteredSentence: null,
      },
      deps
    )

    // Meaning first: its generation succeeds without IPA and the one shared
    // call produces the IPA the pronunciation sibling needs.
    expect(generateFormFacetData).toHaveBeenCalledTimes(1)
    expect(generateFormFacetData).toHaveBeenCalledWith(
      expect.objectContaining({ skill: 'meaning_recognition', targetForm: 'palabras' }),
      deps
    )
    expect(setFacetPayload).toHaveBeenCalledTimes(1)
    expect(setFacetPayload).toHaveBeenCalledWith(
      expect.objectContaining({ skill: 'pronunciation', targetForm: 'palabras', payload: generatedPayload })
    )
  })

  it('leaves the pronunciation sibling pending when the shared payload has no displayable form IPA', async () => {
    const generatedPayload = { form: 'palabras', translation: 'words', grammar: { pos: 'noun' } }
    listFacetsForChunk
      .mockResolvedValueOnce([
        pendingFacet('meaning_recognition', 'palabras'),
        pendingFacet('pronunciation', 'palabras'),
      ])
      .mockResolvedValueOnce([
        { ...pendingFacet('meaning_recognition', 'palabras', 'ready'), payload: generatedPayload, generatedPayload },
        pendingFacet('pronunciation', 'palabras'),
      ])
    vi.mocked(generateFormFacetData).mockResolvedValue('generated')

    await generateStudyIntentFormData(
      {
        userLookupId: lookupId,
        userId,
        formFacetTargets: [
          { skill: 'meaning_recognition', targetForm: 'palabras' },
          { skill: 'pronunciation', targetForm: 'palabras' },
        ],
        encounteredSentence: null,
      },
      deps
    )

    // Copying it would flip the facet ready with an empty card back.
    expect(setFacetPayload).not.toHaveBeenCalled()
  })

  it('leaves siblings pending (no copy) when generation fails — and never throws', async () => {
    listFacetsForChunk.mockResolvedValue([
      pendingFacet('meaning_recognition', 'palabras'),
      pendingFacet('meaning_production', 'palabras'),
    ])
    vi.mocked(generateFormFacetData).mockResolvedValue('failed')

    await expect(
      generateStudyIntentFormData(
        {
          userLookupId: lookupId,
          userId,
          formFacetTargets: [
            { skill: 'meaning_recognition', targetForm: 'palabras' },
            { skill: 'meaning_production', targetForm: 'palabras' },
          ],
          encounteredSentence: null,
        },
        deps
      )
    ).resolves.toBeUndefined()

    expect(setFacetPayload).not.toHaveBeenCalled()
  })

  it('swallows unexpected errors (a throw on the enrichment path would only trigger a guarded retry)', async () => {
    listFacetsForChunk.mockRejectedValue(new Error('db down'))

    await expect(
      generateStudyIntentFormData(
        {
          userLookupId: lookupId,
          userId,
          formFacetTargets: [{ skill: 'meaning_recognition', targetForm: 'palabras' }],
          encounteredSentence: null,
        },
        deps
      )
    ).resolves.toBeUndefined()
  })
})
