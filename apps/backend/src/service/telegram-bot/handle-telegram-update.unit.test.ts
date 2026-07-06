import { describe, expect, test, vi } from 'vitest'
import { handleTelegramUpdate, TelegramBotDependencies } from './handle-telegram-update'
import { MockTelegramApi, MockTelegramApiInterface } from '../../transport/third-party/telegram/telegram-api'
import { TelegramUpdate } from '../../transport/third-party/telegram/telegram-types'
import type { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import type { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import type { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import type { TelegramPairNoncesRepositoryInterface } from '../../transport/database/telegram-pair-nonces/telegram-pair-nonces-repository'
import type {
  TelegramPendingImportRecord,
  TelegramPendingImportsRepositoryInterface,
} from '../../transport/database/telegram-pending-imports/telegram-pending-imports-repository'

const USER_ID = '00000000-0000-0000-0000-000000000001'
const NONCE = '00000000-0000-0000-0000-00000000abcd'

// Unique chat id per test: the per-chat import cooldown is module-level state.
let nextChatId = 1000
const freshChatId = () => String(nextChatId++)

type DepsOverrides = {
  pairedUserId?: string | null
  nativeLanguage?: string | null
  cefrLevel?: string | null
  detectedLanguage?: string | null
  pendingImport?: TelegramPendingImportRecord | null
}

const buildDeps = (
  overrides: DepsOverrides = {}
): TelegramBotDependencies & { telegramApi: MockTelegramApiInterface } => {
  const {
    pairedUserId = USER_ID,
    nativeLanguage = 'en',
    cefrLevel = 'B1',
    detectedLanguage = 'ru',
    pendingImport = null,
  } = overrides
  return {
    telegramApi: MockTelegramApi(),
    usersRepository: {
      findUserIdByTelegramChatId: vi.fn().mockResolvedValue(pairedUserId),
      getNativeLanguage: vi.fn().mockResolvedValue(nativeLanguage),
      setLastTargetLanguage: vi.fn().mockResolvedValue(true),
      clearTelegramChatId: vi.fn().mockResolvedValue(true),
    } as unknown as UsersRepositoryInterface,
    telegramPairNoncesRepository: {
      getOrCreateForChat: vi.fn().mockResolvedValue(NONCE),
      deleteExpired: vi.fn().mockResolvedValue(0),
    } as unknown as TelegramPairNoncesRepositoryInterface,
    telegramPendingImportsRepository: {
      upsertForChat: vi.fn().mockResolvedValue(undefined),
      popForChat: vi.fn().mockResolvedValue(pendingImport),
      deleteExpired: vi.fn().mockResolvedValue(0),
    } as unknown as TelegramPendingImportsRepositoryInterface,
    userTargetLanguagePrefsRepository: {
      findForLanguage: vi.fn().mockResolvedValue(cefrLevel ? { cefr_level: cefrLevel } : null),
      upsertCefr: vi.fn().mockResolvedValue(undefined),
    } as unknown as UserTargetLanguagePrefsRepositoryInterface,
    studySessionsRepository: {
      getOrCreateForImportedText: vi.fn().mockResolvedValue({
        session: { id: 'session-1' },
        track: { id: 'track-1' },
        contentSource: { id: 'source-1' },
        segments: [{}],
      }),
    } as unknown as StudySessionsRepositoryInterface,
    detectLanguage: vi.fn().mockResolvedValue(detectedLanguage),
    importCooldownMs: 0,
  }
}

const textUpdate = (chatId: string, text: string, extras: Record<string, unknown> = {}): TelegramUpdate => ({
  update_id: 1,
  message: {
    message_id: 1,
    chat: { id: Number(chatId), type: 'private' },
    from: { id: 42 },
    text,
    ...extras,
  },
})

describe('handleTelegramUpdate', () => {
  test('unpaired chat: stashes the message and replies with a pairing link', async () => {
    const deps = buildDeps({ pairedUserId: null })
    const chatId = freshChatId()
    await handleTelegramUpdate(textUpdate(chatId, 'Привет мир'), deps)

    expect(deps.telegramPendingImportsRepository.upsertForChat).toHaveBeenCalledWith(
      expect.objectContaining({ chatId, messageText: 'Привет мир' })
    )
    expect(deps.telegramApi.sentMessages).toHaveLength(1)
    expect(deps.telegramApi.sentMessages[0].chatId).toBe(chatId)
    expect(deps.telegramApi.sentMessages[0].text).toContain(`/telegram-pair?nonce=${NONCE}`)
    expect(deps.studySessionsRepository.getOrCreateForImportedText).not.toHaveBeenCalled()
  })

  test('paired chat with prefs in place: replies with the session link', async () => {
    const deps = buildDeps()
    const chatId = freshChatId()
    await handleTelegramUpdate(textUpdate(chatId, 'Привет мир'), deps)

    expect(deps.telegramApi.sentMessages).toHaveLength(1)
    expect(deps.telegramApi.sentMessages[0].text).toContain('/sessions/session-1')
  })

  test('missing CEFR: stashes the message and asks with an A1-C2 inline keyboard', async () => {
    const deps = buildDeps({ cefrLevel: null })
    const chatId = freshChatId()
    await handleTelegramUpdate(textUpdate(chatId, 'Привет мир'), deps)

    expect(deps.telegramPendingImportsRepository.upsertForChat).toHaveBeenCalledWith(
      expect.objectContaining({ chatId, messageText: 'Привет мир' })
    )
    expect(deps.telegramApi.sentMessages).toHaveLength(1)
    const keyboard = deps.telegramApi.sentMessages[0].inlineKeyboard
    expect(keyboard?.flat().map((b) => b.text)).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])
    expect(keyboard?.flat().map((b) => b.callback_data)).toContain('cefr|ru|B2')
  })

  test('uses the forwarded channel title as the session title when present', async () => {
    const deps = buildDeps()
    const chatId = freshChatId()
    await handleTelegramUpdate(
      textUpdate(chatId, 'Привет мир', { forward_origin: { type: 'channel', chat: { title: 'Avvablog' } } }),
      deps
    )
    expect(deps.studySessionsRepository.getOrCreateForImportedText).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Avvablog' })
    )
  })

  test('CEFR callback: saves the level, answers the callback, and resumes the pending import', async () => {
    const chatId = freshChatId()
    const deps = buildDeps({
      pendingImport: {
        chat_id: chatId,
        message_text: 'Привет мир',
        suggested_title: 'Привет мир',
        expires_at: '2100-01-01T00:00:00.000Z',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    })
    await handleTelegramUpdate(
      {
        update_id: 2,
        callback_query: {
          id: 'cb-1',
          data: 'cefr|ru|B2',
          from: { id: 42 },
          message: { chat: { id: Number(chatId), type: 'private' } },
        },
      },
      deps
    )

    expect(deps.userTargetLanguagePrefsRepository.upsertCefr).toHaveBeenCalledWith(USER_ID, 'ru', 'B2')
    expect(deps.telegramApi.answeredCallbackQueries).toHaveLength(1)
    expect(deps.telegramApi.sentMessages).toHaveLength(1)
    expect(deps.telegramApi.sentMessages[0].text).toContain('/sessions/session-1')
  })

  test('CEFR callback with nothing pending: saves the level and asks to re-send', async () => {
    const chatId = freshChatId()
    const deps = buildDeps({ pendingImport: null })
    await handleTelegramUpdate(
      {
        update_id: 3,
        callback_query: {
          id: 'cb-2',
          data: 'cefr|ru|B2',
          from: { id: 42 },
          message: { chat: { id: Number(chatId), type: 'private' } },
        },
      },
      deps
    )

    expect(deps.userTargetLanguagePrefsRepository.upsertCefr).toHaveBeenCalledWith(USER_ID, 'ru', 'B2')
    expect(deps.telegramApi.sentMessages).toHaveLength(1)
    expect(deps.telegramApi.sentMessages[0].text).toContain('send your text again')
  })

  test('CEFR callback with malformed data is answered but ignored', async () => {
    const chatId = freshChatId()
    const deps = buildDeps()
    await handleTelegramUpdate(
      {
        update_id: 4,
        callback_query: {
          id: 'cb-3',
          data: 'cefr|ru|Z9',
          from: { id: 42 },
          message: { chat: { id: Number(chatId), type: 'private' } },
        },
      },
      deps
    )
    expect(deps.userTargetLanguagePrefsRepository.upsertCefr).not.toHaveBeenCalled()
    expect(deps.telegramApi.answeredCallbackQueries).toHaveLength(1)
  })

  test('/start from an unpaired chat greets with a pairing link', async () => {
    const deps = buildDeps({ pairedUserId: null })
    const chatId = freshChatId()
    await handleTelegramUpdate(textUpdate(chatId, '/start'), deps)

    expect(deps.telegramApi.sentMessages).toHaveLength(1)
    expect(deps.telegramApi.sentMessages[0].text).toContain(`/telegram-pair?nonce=${NONCE}`)
    // A bare command must not be stashed as a pending import.
    expect(deps.telegramPendingImportsRepository.upsertForChat).not.toHaveBeenCalled()
  })

  test('/unpair clears the chat link', async () => {
    const deps = buildDeps()
    const chatId = freshChatId()
    await handleTelegramUpdate(textUpdate(chatId, '/unpair'), deps)

    expect(deps.usersRepository.clearTelegramChatId).toHaveBeenCalledWith(USER_ID)
    expect(deps.telegramApi.sentMessages[0].text).toContain('Disconnected')
  })

  test('group chat messages are ignored entirely', async () => {
    const deps = buildDeps()
    await handleTelegramUpdate(
      {
        update_id: 5,
        message: { message_id: 1, chat: { id: 777, type: 'group' }, from: { id: 42 }, text: 'Привет' },
      },
      deps
    )
    expect(deps.telegramApi.sentMessages).toHaveLength(0)
    expect(deps.studySessionsRepository.getOrCreateForImportedText).not.toHaveBeenCalled()
  })

  test('non-text private messages get a text-only reply', async () => {
    const deps = buildDeps()
    const chatId = freshChatId()
    await handleTelegramUpdate(
      { update_id: 6, message: { message_id: 1, chat: { id: Number(chatId), type: 'private' }, from: { id: 42 } } },
      deps
    )
    expect(deps.telegramApi.sentMessages).toHaveLength(1)
    expect(deps.telegramApi.sentMessages[0].text).toContain('text')
  })

  test('unsupported language gets a readable reply', async () => {
    const deps = buildDeps({ detectedLanguage: null })
    const chatId = freshChatId()
    await handleTelegramUpdate(textUpdate(chatId, 'zzz'), deps)
    expect(deps.telegramApi.sentMessages).toHaveLength(1)
    expect(deps.telegramApi.sentMessages[0].text).toContain('languages Flicktionary supports')
  })

  test('a repository error is swallowed and logged, never thrown', async () => {
    const deps = buildDeps()
    deps.usersRepository.findUserIdByTelegramChatId = vi.fn().mockRejectedValue(new Error('db down'))
    await expect(handleTelegramUpdate(textUpdate(freshChatId(), 'Привет'), deps)).resolves.toBeUndefined()
  })
})
