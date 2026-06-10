import { describe, expect, it, vi } from 'vitest'
import { materializeBasicDataChunks } from './materialize-basic-data-chunks'
import type { BasicDataChunk } from '../../transport/third-party/anthropic/passes/basic-data-pass'
import type { CardsRepositoryInterface } from '../../transport/database/cards/cards-repository'
import type { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'

const sessionId = '00000000-0000-0000-0000-000000000001'
const userId = '00000000-0000-0000-0000-000000000002'
const segmentId = '00000000-0000-0000-0000-000000000003'
const lookupId = '00000000-0000-0000-0000-000000000004'

const llmChunk = (overrides: Partial<BasicDataChunk> = {}): BasicDataChunk => ({
  source: 'llm',
  headword: 'palabra',
  sense: 'word',
  surfaceForm: 'palabra',
  segmentId,
  translation: 'word',
  surfaceTranslation: null,
  definition: 'una unidad léxica',
  targetExample: 'Una palabra basta.',
  nativeExample: 'One word is enough.',
  belowCefr: false,
  ...overrides,
})

const createRepos = (lookup: Record<string, unknown>) => {
  const updateContent = vi.fn().mockResolvedValue(undefined)
  const userLookupsRepository = {
    findOrCreate: vi.fn().mockResolvedValue({
      id: lookupId,
      headword: 'palabra',
      translation: null,
      definition: null,
      grounded_at: null,
      grounding_patch: null,
      grammar_user_edited_at: null,
      ...lookup,
    }),
    updateContent,
  } as unknown as UserLookupsRepositoryInterface
  const cardsRepository = {
    insertCard: vi.fn().mockResolvedValue({ id: 'card-1' }),
    insertCardForHighlightIdempotent: vi.fn().mockResolvedValue({ id: 'card-2' }),
  } as unknown as CardsRepositoryInterface
  return { userLookupsRepository, cardsRepository, updateContent }
}

const run = (params: {
  chunk: BasicDataChunk
  lookup?: Record<string, unknown>
  hideTranslationFields: boolean
  repos: ReturnType<typeof createRepos>
}) =>
  materializeBasicDataChunks({
    sessionId,
    userId,
    targetLanguage: 'es',
    chunks: [params.chunk],
    newHighlights: [],
    processedHighlightIds: new Set(),
    segmentIdSet: new Set([segmentId]),
    hideTranslationFields: params.hideTranslationFields,
    cardsRepository: params.repos.cardsRepository,
    userLookupsRepository: params.repos.userLookupsRepository,
  })

describe('materializeBasicDataChunks — translations-off is a generation pref, never a scrub', () => {
  it('first-time fill with translations off: skips LLM translation fields without clearing', async () => {
    const repos = createRepos({})

    await run({ chunk: llmChunk(), hideTranslationFields: true, repos })

    expect(repos.updateContent).toHaveBeenCalledTimes(1)
    const args = repos.updateContent.mock.calls[0]![0]
    expect(args.translation).toBeNull()
    expect(args.nativeExample).toBeNull()
    expect(args.definition).toBe('una unidad léxica')
    // null-without-clear preserves existing column values in updateContent —
    // the clear flags must never ride along with the pref.
    expect(args.clearTranslation).toBeUndefined()
    expect(args.clearNativeExample).toBeUndefined()
  })

  it('first-time fill with translations on: passes the LLM translation fields through', async () => {
    const repos = createRepos({})

    await run({ chunk: llmChunk(), hideTranslationFields: false, repos })

    const args = repos.updateContent.mock.calls[0]![0]
    expect(args.translation).toBe('word')
    expect(args.nativeExample).toBe('One word is enough.')
    expect(args.clearTranslation).toBeUndefined()
    expect(args.clearNativeExample).toBeUndefined()
  })

  it('existing chunk + grammar merge with translations off: touches only the grammar bag', async () => {
    // Regression guard for the main wiper: this branch runs whenever a later
    // session re-encounters a chunk, and used to clear a manual translation.
    const repos = createRepos({ translation: 'manual translation', definition: 'existing def' })

    await run({
      chunk: llmChunk({ grammar: { pos: 'noun' } }),
      hideTranslationFields: true,
      repos,
    })

    expect(repos.updateContent).toHaveBeenCalledTimes(1)
    expect(repos.updateContent).toHaveBeenCalledWith({
      id: lookupId,
      grammarPatch: { pos: 'noun' },
    })
  })

  it('existing chunk, no grammar, translations off: leaves the row completely untouched', async () => {
    // The dedicated scrub-only branch is gone — re-encountering a manually
    // translated chunk must not write anything at all.
    const repos = createRepos({ translation: 'manual translation', definition: 'existing def' })

    await run({ chunk: llmChunk(), hideTranslationFields: true, repos })

    expect(repos.updateContent).not.toHaveBeenCalled()
  })
})

describe('materializeBasicDataChunks — grammar patch', () => {
  // grammar.studied_form was dropped (per-form study lives in study_facets), so
  // the grammar patch carries only the LLM's grammar bag — never a studied_form
  // artifact, regardless of the surface form being an inflection.
  it('does not fold a studied_form artifact into the grammar patch', async () => {
    const repos = createRepos({})

    await run({
      chunk: llmChunk({ surfaceForm: 'palabras', surfaceTranslation: 'words', grammar: { pos: 'noun' } }),
      hideTranslationFields: false,
      repos,
    })

    const args = repos.updateContent.mock.calls[0]![0]
    expect(args.grammarPatch).toEqual({ pos: 'noun' })
  })
})
