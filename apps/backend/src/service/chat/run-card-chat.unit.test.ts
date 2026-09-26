import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MockAnthropicPasses } from '../../transport/third-party/anthropic/anthropic-passes'
import { getLanguageMode } from '../user-prefs/language-mode'
import { buildPromptContext } from '../processing/build-prompt-context'
import { runCardChat, type RunCardChatDependencies } from './run-card-chat'

vi.mock('../user-prefs/language-mode', () => ({
  getLanguageMode: vi.fn(),
}))
vi.mock('../processing/build-prompt-context', () => ({
  buildPromptContext: vi.fn(),
}))
vi.mock('../processing/select-surrounding-segments', () => ({
  selectSurroundingSegments: vi.fn().mockResolvedValue([]),
  formatSurroundingSegments: vi.fn().mockReturnValue('(none)'),
}))

const cardId = '00000000-0000-0000-0000-000000000001'
const userId = '00000000-0000-0000-0000-000000000002'
const sessionId = '00000000-0000-0000-0000-000000000003'
const lookupId = '00000000-0000-0000-0000-000000000004'

const card = {
  id: cardId,
  study_session_id: sessionId,
  segment_id: '00000000-0000-0000-0000-000000000005',
  user_lookup_id: lookupId,
  surface_form: 'palabra',
  chunk: {
    headword: 'palabra',
    sense: 'word',
    definition: 'una unidad léxica',
    target_example: 'Una palabra basta.',
    translation: null,
    native_example: null,
    grammar: {},
    exploration_extras: {},
  },
}

const session = {
  id: sessionId,
  target_language: 'es',
  native_language: 'fr',
  text_track_id: '00000000-0000-0000-0000-000000000006',
  cefr_level: 'B1',
  context_blob: 'a cached blob',
}

type LanguagePrefs = Awaited<ReturnType<typeof getLanguageMode>>

const prefOffMode = {
  nativeLanguage: 'fr',
  targetLanguage: 'es',
  sameLanguage: false,
  showTranslationsEnabled: false,
  hideTranslationFields: true,
  allowL1Notes: true,
} as LanguagePrefs

const sameLanguageMode = {
  nativeLanguage: 'es',
  targetLanguage: 'es',
  sameLanguage: true,
  showTranslationsEnabled: true,
  hideTranslationFields: true,
  allowL1Notes: false,
} as LanguagePrefs

// An Opus turn whose tool call tries to set a translation.
const translationToolResponse = {
  content: [
    { type: 'text', text: 'Added it.' },
    { type: 'tool_use', id: 'tu_1', name: 'update_card_fields', input: { translation: 'le mot' } },
  ],
}

const createDeps = () => {
  const updateContent = vi.fn().mockResolvedValue(undefined)
  const insertMessage = vi.fn().mockImplementation(async (m: { role: string; content: string }) => ({
    id: `msg-${m.role}`,
    role: m.role,
    content: m.content,
  }))
  const deps = {
    anthropicPasses: MockAnthropicPasses({
      createChatCompletion: vi.fn().mockResolvedValue(translationToolResponse) as never,
    }),
    cardsRepository: {
      findByIdForUser: vi.fn().mockResolvedValue(card),
      updateFields: vi.fn().mockResolvedValue(undefined),
    },
    cardChatMessagesRepository: {
      listByCardId: vi.fn().mockResolvedValue([]),
      insertMessage,
      insertSeededMessage: vi.fn(),
      findSeededAssistant: vi.fn(),
    },
    studySessionsRepository: {
      findByIdForUser: vi.fn().mockResolvedValue(session),
    },
    textSegmentsRepository: {},
    userLookupsRepository: {
      updateContent,
      renameKey: vi.fn().mockResolvedValue({ ok: true }),
    },
    usersRepository: { getIpaDialects: vi.fn().mockResolvedValue({ en: 'ga', es: 'lam', pt: 'br' }) },
    userTargetLanguagePrefsRepository: {},
  } as unknown as RunCardChatDependencies
  return { deps, updateContent, insertMessage }
}

describe('runCardChat — translation patches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(buildPromptContext).mockResolvedValue({ systemBlocks: [] } as unknown as Awaited<
      ReturnType<typeof buildPromptContext>
    >)
  })

  it('translations off: an explicitly requested translation is persisted without clear flags', async () => {
    vi.mocked(getLanguageMode).mockResolvedValue(prefOffMode)
    const { deps, updateContent, insertMessage } = createDeps()

    const result = await runCardChat({ cardId, userId, content: 'Add a French translation please' }, deps)

    expect(updateContent).toHaveBeenCalledTimes(1)
    const args = updateContent.mock.calls[0]![0]
    expect(args.translation).toBe('le mot')
    // The translations-off pref must never scrub the row it is writing to.
    expect(args.clearTranslation).toBeUndefined()
    expect(args.clearNativeExample).toBeUndefined()
    expect(result.assistantMessage.content).toContain('Updated: translation')
    expect(insertMessage).toHaveBeenCalledTimes(2)
  })

  it('sameLanguage: a translation-only patch is dropped entirely', async () => {
    vi.mocked(getLanguageMode).mockResolvedValue(sameLanguageMode)
    const { deps, updateContent } = createDeps()

    const result = await runCardChat({ cardId, userId, content: 'Add a translation please' }, deps)

    expect(updateContent).not.toHaveBeenCalled()
    expect(result.assistantMessage.content).not.toContain('Updated:')
  })

  it('translations on: translation passes through unchanged (sanity)', async () => {
    vi.mocked(getLanguageMode).mockResolvedValue({
      ...prefOffMode,
      showTranslationsEnabled: true,
      hideTranslationFields: false,
    } as LanguagePrefs)
    const { deps, updateContent } = createDeps()

    await runCardChat({ cardId, userId, content: 'Fix the translation' }, deps)

    expect(updateContent).toHaveBeenCalledWith(expect.objectContaining({ id: lookupId, translation: 'le mot' }))
  })
})

describe('runCardChat — updatedChunk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(buildPromptContext).mockResolvedValue({ systemBlocks: [] } as unknown as Awaited<
      ReturnType<typeof buildPromptContext>
    >)
  })

  it('returns the REFETCHED chunk after a tool patch (not the pre-patch row)', async () => {
    vi.mocked(getLanguageMode).mockResolvedValue({
      ...prefOffMode,
      showTranslationsEnabled: true,
      hideTranslationFields: false,
    } as LanguagePrefs)
    const { deps } = createDeps()
    const patchedChunk = { ...card.chunk, translation: 'le mot' }
    vi.mocked(deps.cardsRepository.findByIdForUser)
      .mockResolvedValueOnce(card as never)
      .mockResolvedValue({ ...card, chunk: patchedChunk } as never)

    const result = await runCardChat({ cardId, userId, content: 'Fix the translation' }, deps)

    expect(result.updatedChunk).toEqual(patchedChunk)
  })

  it('is null for a purely conversational turn', async () => {
    vi.mocked(getLanguageMode).mockResolvedValue(prefOffMode)
    const { deps } = createDeps()
    vi.mocked(deps.anthropicPasses.createChatCompletion).mockResolvedValue({
      content: [{ type: 'text', text: 'Great question — it means "word".' }],
    } as never)

    const result = await runCardChat({ cardId, userId, content: 'What does it mean?' }, deps)

    expect(result.updatedChunk).toBeNull()
    // No patch → no refetch beyond the initial ownership read.
    expect(deps.cardsRepository.findByIdForUser).toHaveBeenCalledTimes(1)
  })

  it('is null when the whole patch was dropped (sameLanguage translation-only)', async () => {
    vi.mocked(getLanguageMode).mockResolvedValue(sameLanguageMode)
    const { deps } = createDeps()

    const result = await runCardChat({ cardId, userId, content: 'Add a translation please' }, deps)

    expect(result.updatedChunk).toBeNull()
  })
})

describe('runCardChat — tool_result follow-up turn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(buildPromptContext).mockResolvedValue({ systemBlocks: [] } as unknown as Awaited<
      ReturnType<typeof buildPromptContext>
    >)
    vi.mocked(getLanguageMode).mockResolvedValue({
      ...prefOffMode,
      showTranslationsEnabled: true,
      hideTranslationFields: false,
    } as LanguagePrefs)
  })

  // Opus 5.5 shape: no text, only a (hidden) thinking block and the tool call.
  const silentToolTurn = {
    stop_reason: 'tool_use',
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'tool_use', id: 'tu_1', name: 'update_card_fields', input: { translation: 'le mot' } },
    ],
  }

  it('sends the first response back with a tool_result and uses the follow-up text as the reply', async () => {
    const { deps } = createDeps()
    const createChatCompletion = vi.mocked(deps.anthropicPasses.createChatCompletion)
    createChatCompletion.mockReset()
    createChatCompletion
      .mockResolvedValueOnce(silentToolTurn as never)
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Changed it — "le mot" is neutral.' }] } as never)

    const result = await runCardChat({ cardId, userId, content: 'Change the translation and explain' }, deps)

    expect(createChatCompletion).toHaveBeenCalledTimes(2)
    const followUp = createChatCompletion.mock.calls[1]![0]
    expect(followUp.tool_choice).toEqual({ type: 'none' })
    expect(followUp.tools).toHaveLength(1)
    const [assistantTurn, toolResultTurn] = followUp.messages.slice(-2)
    // Passed back unchanged, thinking block included.
    expect(assistantTurn).toEqual({ role: 'assistant', content: silentToolTurn.content })
    expect(toolResultTurn!.content).toEqual([
      { type: 'tool_result', tool_use_id: 'tu_1', content: 'Applied: translation.' },
    ])
    expect(result.assistantMessage.content).toBe('Changed it — "le mot" is neutral.\n\n_Updated: translation_')
  })

  it('tells the model why a rename was rejected', async () => {
    const { deps } = createDeps()
    vi.mocked(deps.userLookupsRepository.renameKey).mockResolvedValue({ ok: false, reason: 'CONFLICT' })
    const createChatCompletion = vi.mocked(deps.anthropicPasses.createChatCompletion)
    createChatCompletion.mockReset()
    createChatCompletion
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'tu_1', name: 'update_card_fields', input: { headword: 'palabrita' } }],
      } as never)
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'That headword already exists.' }] } as never)

    const result = await runCardChat({ cardId, userId, content: 'Rename it to palabrita' }, deps)

    const toolResult = createChatCompletion.mock.calls[1]![0].messages.at(-1)!.content as Array<{ content: string }>
    expect(toolResult[0]!.content).toContain('No card fields were changed.')
    expect(toolResult[0]!.content).toContain('headword/sense were not changed')
    expect(result.assistantMessage.content).toBe('That headword already exists.')
  })

  it('answers every tool_use block, flagging extra update calls as errors', async () => {
    const { deps, updateContent } = createDeps()
    const createChatCompletion = vi.mocked(deps.anthropicPasses.createChatCompletion)
    createChatCompletion.mockReset()
    createChatCompletion
      .mockResolvedValueOnce({
        content: [
          { type: 'tool_use', id: 'tu_1', name: 'update_card_fields', input: { translation: 'le mot' } },
          { type: 'tool_use', id: 'tu_2', name: 'update_card_fields', input: { definition: 'autre' } },
        ],
      } as never)
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Done with the translation.' }] } as never)

    await runCardChat({ cardId, userId, content: 'Fix both' }, deps)

    expect(updateContent).toHaveBeenCalledTimes(1)
    const toolResults = createChatCompletion.mock.calls[1]![0].messages.at(-1)!.content as Array<{
      tool_use_id: string
      is_error?: boolean
    }>
    expect(toolResults.map((r) => [r.tool_use_id, r.is_error ?? false])).toEqual([
      ['tu_1', false],
      ['tu_2', true],
    ])
  })

  it('makes a single call for a conversational turn', async () => {
    const { deps } = createDeps()
    vi.mocked(deps.anthropicPasses.createChatCompletion).mockResolvedValue({
      content: [{ type: 'text', text: 'It means "word".' }],
    } as never)

    await runCardChat({ cardId, userId, content: 'What does it mean?' }, deps)

    expect(deps.anthropicPasses.createChatCompletion).toHaveBeenCalledTimes(1)
  })
})
