import { getConfig } from '../../../config/environment-config'
import { TelegramInlineKeyboardButton, TelegramUpdate } from './telegram-types'

export type SendMessageParams = {
  chatId: string
  text: string
  inlineKeyboard?: TelegramInlineKeyboardButton[][]
}

export interface TelegramApiInterface {
  sendMessage: (params: SendMessageParams) => Promise<void>
  answerCallbackQuery: (params: { callbackQueryId: string; text?: string }) => Promise<void>
  getUpdates: (params: { offset: number | null; timeoutSeconds: number }) => Promise<TelegramUpdate[]>
  deleteWebhook: () => Promise<void>
}

type TelegramApiResponse<T> = { ok: boolean; result?: T; description?: string }

const callTelegram = async <T>(method: string, body: Record<string, unknown>): Promise<T> => {
  const url = `https://api.telegram.org/bot${getConfig().telegramBotToken}/${method}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await response.json().catch(() => null)) as TelegramApiResponse<T> | null
  if (!response.ok || !data?.ok) {
    throw new Error(`Telegram ${method} failed: ${response.status} ${data?.description ?? response.statusText}`)
  }
  return data.result as T
}

export const TelegramApi = (): TelegramApiInterface => ({
  sendMessage: async ({ chatId, text, inlineKeyboard }) => {
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text,
      // Pairing/session links point at localhost in dev and would render as
      // broken preview cards; the message text is the whole payload anyway.
      link_preview_options: { is_disabled: true },
      ...(inlineKeyboard ? { reply_markup: { inline_keyboard: inlineKeyboard } } : {}),
    })
  },

  answerCallbackQuery: async ({ callbackQueryId, text }) => {
    await callTelegram('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    })
  },

  getUpdates: async ({ offset, timeoutSeconds }) => {
    return await callTelegram<TelegramUpdate[]>('getUpdates', {
      ...(offset !== null ? { offset } : {}),
      timeout: timeoutSeconds,
      allowed_updates: ['message', 'callback_query'],
    })
  },

  deleteWebhook: async () => {
    await callTelegram('deleteWebhook', {})
  },
})

// Records calls instead of hitting Telegram — the buildApp default, so tests
// and mocked dev runs never do network I/O. Mirrors MockEnrichmentWorker.
export type MockTelegramApiInterface = TelegramApiInterface & {
  sentMessages: SendMessageParams[]
  answeredCallbackQueries: { callbackQueryId: string; text?: string }[]
}

export const MockTelegramApi = (): MockTelegramApiInterface => {
  const sentMessages: SendMessageParams[] = []
  const answeredCallbackQueries: { callbackQueryId: string; text?: string }[] = []
  return {
    sentMessages,
    answeredCallbackQueries,
    sendMessage: async (params) => {
      sentMessages.push(params)
    },
    answerCallbackQuery: async (params) => {
      answeredCallbackQueries.push(params)
    },
    getUpdates: async () => [],
    deleteWebhook: async () => {},
  }
}
