import { CefrLevelSchema } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { getLanguageName, isSupportedLanguageCode } from '@flicktionary/core/constants/supported-languages'
import { getConfig } from '../../config/environment-config'
import { ProcessingJobsRepositoryInterface } from '../../transport/database/processing-jobs/processing-jobs-repository'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import { TextTracksRepositoryInterface } from '../../transport/database/text-tracks/text-tracks-repository'
import { TelegramAuthNoncesRepositoryInterface } from '../../transport/database/telegram-auth-nonces/telegram-auth-nonces-repository'
import { TelegramPairNoncesRepositoryInterface } from '../../transport/database/telegram-pair-nonces/telegram-pair-nonces-repository'
import { TelegramPendingImportsRepositoryInterface } from '../../transport/database/telegram-pending-imports/telegram-pending-imports-repository'
import { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import type { AnthropicPassesInterface } from '../../transport/third-party/anthropic/anthropic-passes'
import { logWithSentry } from '../../transport/third-party/sentry/error-monitoring'
import { TelegramApiInterface } from '../../transport/third-party/telegram/telegram-api'
import {
  TelegramCallbackQuery,
  TelegramMessage,
  TelegramUpdate,
} from '../../transport/third-party/telegram/telegram-types'
import { importTextForUser, suggestTitleFromText } from '../study-sessions/import-text'

export type TelegramBotDependencies = {
  telegramApi: TelegramApiInterface
  usersRepository: UsersRepositoryInterface
  telegramPairNoncesRepository: TelegramPairNoncesRepositoryInterface
  telegramAuthNoncesRepository: TelegramAuthNoncesRepositoryInterface
  telegramPendingImportsRepository: TelegramPendingImportsRepositoryInterface
  userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface
  studySessionsRepository: StudySessionsRepositoryInterface
  textTracksRepository: TextTracksRepositoryInterface
  processingJobsRepository: ProcessingJobsRepositoryInterface
  anthropicPasses: AnthropicPassesInterface
  // Injectable so unit tests can disable the per-chat throttle.
  importCooldownMs?: number
}

// The pairing link must survive a full signup (magic-link email round trip),
// so it lives far longer than the extension's 120s nonce. Pending imports
// last a day: long enough to finish signup whenever, short enough that stale
// stashed text doesn't resurrect out of nowhere.
const PAIR_NONCE_TTL_SECONDS = 60 * 60
const PENDING_IMPORT_TTL_SECONDS = 24 * 60 * 60

// Session links open in Telegram's in-app browser, which shares no cookies
// with the user's real browser — so each link carries a single-use sign-in
// nonce the web app exchanges for a session (telegramAuth.exchangeNonce).
// Short TTL: the first tap happens right after the reply lands; an expired
// nonce degrades to the normal login screen.
const AUTH_NONCE_TTL_SECONDS = 10 * 60

// Every content message triggers a Haiku language-detection call, and the
// webhook mounts ahead of the global rate limiter — this per-chat cooldown is
// the only throttle between a message flood and the LLM.
const DEFAULT_IMPORT_COOLDOWN_MS = 3_000
const lastImportAttemptAtByChatId = new Map<string, number>()

const CEFR_CALLBACK_PREFIX = 'cefr'

// Google OAuth (and passkeys) cannot complete inside Telegram's in-app
// browser, and pairing links can't sign the user in by themselves (there is
// no paired account yet) — so pairing has to happen in the user's real
// browser. Session links don't need this tip: they carry their own sign-in
// nonce and work anywhere.
const OPEN_IN_BROWSER_TIP =
  "Tip: open that link in your usual browser (long-press it to copy, or tap the browser button inside Telegram's viewer) — signing in with Google doesn't work in Telegram's built-in browser."

const cefrKeyboard = (targetLanguage: string) => {
  const levels = CefrLevelSchema.options
  const button = (level: string) => ({
    text: level,
    callback_data: `${CEFR_CALLBACK_PREFIX}|${targetLanguage}|${level}`,
  })
  return [levels.slice(0, 3).map(button), levels.slice(3).map(button)]
}

const pairingLinkMessage = async (
  chatId: string,
  telegramUserId: string | null,
  deps: TelegramBotDependencies
): Promise<string> => {
  const nonce = await deps.telegramPairNoncesRepository.getOrCreateForChat(
    chatId,
    telegramUserId,
    PAIR_NONCE_TTL_SECONDS
  )
  return `${getConfig().webUrl}/telegram-pair?nonce=${nonce}`
}

// Runs one import attempt for a paired chat and maps every outcome to a chat
// reply. Exported for the pairing router's resume path.
export const runImportAttempt = async (
  params: { chatId: string; userId: string; text: string; suggestedTitle: string },
  deps: TelegramBotDependencies
): Promise<void> => {
  const { chatId, userId, text, suggestedTitle } = params
  const { telegramApi } = deps

  const result = await importTextForUser(
    { userId, text, title: suggestedTitle, sourceUrl: null },
    {
      studySessionsRepository: deps.studySessionsRepository,
      usersRepository: deps.usersRepository,
      userTargetLanguagePrefsRepository: deps.userTargetLanguagePrefsRepository,
      anthropicPasses: deps.anthropicPasses,
      textTracksRepository: deps.textTracksRepository,
      processingJobsRepository: deps.processingJobsRepository,
    }
  )

  if (result.ok) {
    const authNonce = await deps.telegramAuthNoncesRepository.createForUser(userId, AUTH_NONCE_TTL_SECONDS)
    await telegramApi.sendMessage({
      chatId,
      text: `Ready to read: ${getConfig().webUrl}/sessions/${result.sessionId}?auth=${authNonce}`,
    })
    return
  }

  if (result.reason === 'missing-cefr') {
    // Stash the text so the CEFR button answer can resume the import without
    // the user re-sending the message.
    await deps.telegramPendingImportsRepository.upsertForChat({
      chatId,
      messageText: text,
      suggestedTitle,
      ttlSeconds: PENDING_IMPORT_TTL_SECONDS,
    })
    const languageName = getLanguageName(result.targetLanguage)
    await telegramApi.sendMessage({
      chatId,
      text: `What's your ${languageName} level? I'll use it to pitch explanations right.`,
      inlineKeyboard: cefrKeyboard(result.targetLanguage),
    })
    return
  }

  if (result.reason === 'needs-onboarding') {
    // Rare: paired but native language never set (onboarding abandoned).
    // Onboarding is a one-time web flow — don't replicate it in chat.
    await telegramApi.sendMessage({
      chatId,
      text: `Almost there — finish setting up your account at ${getConfig().webUrl}, then send your text again.`,
    })
    return
  }

  if (result.reason === 'unsupported') {
    await telegramApi.sendMessage({
      chatId,
      text: "Sorry, I couldn't recognize that as one of the languages Flicktionary supports yet.",
    })
    return
  }

  await telegramApi.sendMessage({
    chatId,
    text: "I couldn't find any readable text in that message.",
  })
}

// Pops the stashed pending import for a chat (if any) and re-runs it. Called
// from the CEFR callback and from the web pairing flow's completePending.
export const resumePendingImportForChat = async (
  chatId: string,
  deps: TelegramBotDependencies
): Promise<{ resumed: boolean }> => {
  const pending = await deps.telegramPendingImportsRepository.popForChat(chatId)
  if (!pending) return { resumed: false }

  const userId = await deps.usersRepository.findUserIdByTelegramChatId(chatId)
  if (!userId) return { resumed: false }

  await runImportAttempt({ chatId, userId, text: pending.message_text, suggestedTitle: pending.suggested_title }, deps)
  return { resumed: true }
}

const handleCommand = async (
  params: { chatId: string; telegramUserId: string | null; command: string; userId: string | null },
  deps: TelegramBotDependencies
): Promise<void> => {
  const { chatId, telegramUserId, command, userId } = params
  const { telegramApi } = deps

  if (command === '/unpair') {
    if (userId) {
      await deps.usersRepository.clearTelegramChatId(userId)
      await telegramApi.sendMessage({
        chatId,
        text: 'Disconnected. Send me a message any time to connect again.',
      })
    } else {
      await telegramApi.sendMessage({ chatId, text: 'This chat is not connected to a Flicktionary account.' })
    }
    return
  }

  // /start, /help, and anything unrecognized get the greeting.
  const greeting =
    'Send or forward me a message in the language you are learning and I will turn it into a Flicktionary reading session.'
  if (userId) {
    await telegramApi.sendMessage({ chatId, text: greeting })
    return
  }
  const link = await pairingLinkMessage(chatId, telegramUserId, deps)
  await telegramApi.sendMessage({
    chatId,
    text: `${greeting}\n\nFirst, connect your Flicktionary account (I will remember it): ${link}\n\n${OPEN_IN_BROWSER_TIP}`,
  })
}

const handleMessage = async (message: TelegramMessage, deps: TelegramBotDependencies): Promise<void> => {
  // The bot is a 1:1 assistant; in groups it would trigger on every message
  // and leak session links to other members. Stay silent entirely.
  if (message.chat.type !== 'private') return

  const chatId = String(message.chat.id)
  const telegramUserId = message.from ? String(message.from.id) : null
  const text = message.text
  const { telegramApi } = deps

  const userId = await deps.usersRepository.findUserIdByTelegramChatId(chatId)

  if (!text) {
    await telegramApi.sendMessage({
      chatId,
      text: 'I can only read text messages for now — send or forward me some text.',
    })
    return
  }

  if (text.startsWith('/')) {
    await handleCommand({ chatId, telegramUserId, command: text.split(' ')[0], userId }, deps)
    return
  }

  const suggestedTitle = message.forward_origin?.chat?.title ?? suggestTitleFromText(text)

  if (!userId) {
    // Stash the message so pairing can finish with "your link is on its way"
    // instead of asking the user to re-send.
    await deps.telegramPendingImportsRepository.upsertForChat({
      chatId,
      messageText: text,
      suggestedTitle,
      ttlSeconds: PENDING_IMPORT_TTL_SECONDS,
    })
    const link = await pairingLinkMessage(chatId, telegramUserId, deps)
    await telegramApi.sendMessage({
      chatId,
      text: `To read this in Flicktionary, connect your account first (one time only): ${link}\n\n${OPEN_IN_BROWSER_TIP}`,
    })
    return
  }

  const cooldownMs = deps.importCooldownMs ?? DEFAULT_IMPORT_COOLDOWN_MS
  const lastAttemptAt = lastImportAttemptAtByChatId.get(chatId) ?? 0
  const now = Date.now()
  if (now - lastAttemptAt < cooldownMs) {
    await telegramApi.sendMessage({ chatId, text: 'One at a time please — try again in a few seconds.' })
    return
  }
  lastImportAttemptAtByChatId.set(chatId, now)

  await runImportAttempt({ chatId, userId, text, suggestedTitle }, deps)
}

const handleCallbackQuery = async (
  callbackQuery: TelegramCallbackQuery,
  deps: TelegramBotDependencies
): Promise<void> => {
  const { telegramApi } = deps
  const chatId = callbackQuery.message ? String(callbackQuery.message.chat.id) : null

  const answer = (text?: string) =>
    telegramApi.answerCallbackQuery({ callbackQueryId: callbackQuery.id, ...(text ? { text } : {}) })

  if (!chatId || !callbackQuery.data) {
    await answer()
    return
  }

  const [prefix, targetLanguage, cefrLevel] = callbackQuery.data.split('|')
  const isValidCefr = (CefrLevelSchema.options as readonly string[]).includes(cefrLevel)
  if (prefix !== CEFR_CALLBACK_PREFIX || !isSupportedLanguageCode(targetLanguage) || !isValidCefr) {
    await answer()
    return
  }

  const userId = await deps.usersRepository.findUserIdByTelegramChatId(chatId)
  if (!userId) {
    await answer()
    await telegramApi.sendMessage({
      chatId,
      text: 'This chat is not connected to a Flicktionary account — send me a message to connect.',
    })
    return
  }

  await deps.userTargetLanguagePrefsRepository.upsertCefr(userId, targetLanguage, cefrLevel)
  await answer(`${getLanguageName(targetLanguage)} level saved: ${cefrLevel}`)

  const { resumed } = await resumePendingImportForChat(chatId, deps)
  if (!resumed) {
    await telegramApi.sendMessage({
      chatId,
      text: 'Level saved. That import request expired though — just send your text again.',
    })
  }
}

// Single entry point for both transports (prod webhook + dev polling).
// Never throws: Telegram redelivers on errors, and a poison update must not
// wedge the polling loop.
export const handleTelegramUpdate = async (update: TelegramUpdate, deps: TelegramBotDependencies): Promise<void> => {
  try {
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query, deps)
    } else if (update.message) {
      await handleMessage(update.message, deps)
    }
  } catch (error) {
    // Never log message bodies — they are private user content.
    logWithSentry({
      message: 'Failed to handle Telegram update',
      params: {
        updateId: update.update_id,
        hasMessage: Boolean(update.message),
        hasCallbackQuery: Boolean(update.callback_query),
        textLength: update.message?.text?.length ?? 0,
      },
      error,
    })
  }
}
