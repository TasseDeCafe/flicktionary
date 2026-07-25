import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateFormFacetData, GenerateFormFacetDataDeps } from './generate-form-facet-data'
import { MockAnthropicPasses } from '../../transport/third-party/anthropic/anthropic-passes'
import { getLanguageMode } from '../user-prefs/language-mode'

vi.mock('../user-prefs/language-mode', () => ({
  getLanguageMode: vi.fn(),
}))
vi.mock('../../transport/third-party/sentry/error-monitoring', () => ({
  logCustomErrorMessageAndError: vi.fn(),
}))

// Injected through deps.anthropicPasses; tests script it per case with
// vi.mocked(generateFormData).mockResolvedValue(...).
const generateFormData = vi.fn()

const userId = '00000000-0000-0000-0000-000000000001'
const chunkId = '00000000-0000-0000-0000-000000000002'

const formResult = {
  form: 'стола́',
  displayForm: 'стола́',
  translation: 'of the table',
  definition: null,
  targetExample: 'У стола́ четыре ножки.',
  nativeExample: 'The table has four legs.',
  pos: 'noun' as const,
  ipa: '[stɐˈla]',
}

const createDeps = (overrides?: { targetLanguage?: string; englishIpaDialect?: 'ga' | 'rp' }) => {
  const getChunkRowForUser = vi.fn().mockResolvedValue({
    id: chunkId,
    headword: 'стол',
    translation: 'table',
    targetLanguage: overrides?.targetLanguage ?? 'ru',
  })
  const listFacetsForChunk = vi.fn().mockResolvedValue([
    {
      skill: 'pronunciation',
      targetForm: 'стола',
      enabled: true,
      dataStatus: 'pending_data',
      srsState: null,
      payload: { form: 'стола' },
      generatedPayload: null,
      source: null,
    },
    {
      skill: 'meaning_recognition',
      targetForm: 'стола',
      enabled: true,
      dataStatus: 'pending_data',
      srsState: null,
      payload: { form: 'стола' },
      generatedPayload: null,
      source: null,
    },
  ])
  const setFacetPayload = vi.fn().mockResolvedValue(undefined)
  const getIpaDialects = vi.fn().mockResolvedValue({ en: overrides?.englishIpaDialect ?? 'ga', es: 'lam', pt: 'br' })
  const deps = {
    anthropicPasses: MockAnthropicPasses({ generateFormData: generateFormData as never }),
    userLookupsRepository: { getChunkRowForUser, listFacetsForChunk, setFacetPayload },
    usersRepository: { getIpaDialects },
    userTargetLanguagePrefsRepository: {},
  } as unknown as GenerateFormFacetDataDeps
  return { deps, setFacetPayload, getIpaDialects }
}

const run = (deps: GenerateFormFacetDataDeps, skill: 'pronunciation' | 'meaning_recognition') =>
  generateFormFacetData({ chunkId, userId, skill, targetForm: 'стола', encounteredSentence: null }, deps)

describe('generateFormFacetData — per-form pronunciation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getLanguageMode).mockResolvedValue({
      nativeLanguage: 'en',
      hideTranslationFields: false,
      allowL1Notes: true,
    } as Awaited<ReturnType<typeof getLanguageMode>>)
  })

  it('flips a pronunciation facet ready when generation produced the form IPA, written as a grammar.ipa bag', async () => {
    const { deps, setFacetPayload } = createDeps()
    vi.mocked(generateFormData).mockResolvedValue(formResult)

    const outcome = await run(deps, 'pronunciation')

    expect(outcome).toBe('generated')
    expect(setFacetPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        skill: 'pronunciation',
        targetForm: 'стола',
        payload: expect.objectContaining({
          form: 'стола́',
          grammar: { pos: 'noun', display_form: 'стола́', ipa: { untagged: '[stɐˈla]' } },
        }),
      })
    )
  })

  it("leaves a pronunciation facet pending (outcome 'failed', no setFacetPayload) when the model returned no confident IPA", async () => {
    const { deps, setFacetPayload } = createDeps()
    vi.mocked(generateFormData).mockResolvedValue({ ...formResult, ipa: null })

    const outcome = await run(deps, 'pronunciation')

    expect(outcome).toBe('failed')
    expect(setFacetPayload).not.toHaveBeenCalled()
  })

  it('buckets English form IPA into the user dialect (rp)', async () => {
    const { deps, setFacetPayload } = createDeps({ targetLanguage: 'en', englishIpaDialect: 'rp' })
    vi.mocked(generateFormData).mockResolvedValue({
      ...formResult,
      form: 'houses',
      displayForm: null,
      ipa: '/ˈhaʊzɪz/',
    })

    await run(deps, 'pronunciation')

    expect(vi.mocked(generateFormData)).toHaveBeenCalledWith(expect.objectContaining({ englishIpaDialect: 'rp' }))
    const payload = setFacetPayload.mock.calls[0]![0].payload as { grammar: { ipa: Record<string, string> } }
    expect(payload.grammar.ipa).toEqual({ rp: '/ˈhaʊzɪz/' })
  })

  it('translations-off does NOT take the no-model shortcut for pronunciation — runs the model, blanks the translation', async () => {
    vi.mocked(getLanguageMode).mockResolvedValue({
      nativeLanguage: 'ru',
      hideTranslationFields: true,
      allowL1Notes: false,
    } as Awaited<ReturnType<typeof getLanguageMode>>)
    const { deps, setFacetPayload } = createDeps()
    vi.mocked(generateFormData).mockResolvedValue(formResult)

    const outcome = await run(deps, 'pronunciation')

    expect(outcome).toBe('generated')
    expect(generateFormData).toHaveBeenCalled()
    const payload = setFacetPayload.mock.calls[0]![0].payload as Record<string, unknown>
    expect(payload.translation).toBe('')
    expect(payload.nativeExample).toBeUndefined()
    expect(payload.grammar).toEqual({ pos: 'noun', display_form: 'стола́', ipa: { untagged: '[stɐˈla]' } })
  })

  it('translations-off still takes the bare no-model shortcut for meaning skills', async () => {
    vi.mocked(getLanguageMode).mockResolvedValue({
      nativeLanguage: 'ru',
      hideTranslationFields: true,
      allowL1Notes: false,
    } as Awaited<ReturnType<typeof getLanguageMode>>)
    const { deps, setFacetPayload } = createDeps()

    const outcome = await run(deps, 'meaning_recognition')

    expect(outcome).toBe('generated')
    expect(generateFormData).not.toHaveBeenCalled()
    expect(setFacetPayload).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ form: 'стола', translation: '' }) })
    )
  })
})
