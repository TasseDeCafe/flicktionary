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
    usersRepository: {},
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
