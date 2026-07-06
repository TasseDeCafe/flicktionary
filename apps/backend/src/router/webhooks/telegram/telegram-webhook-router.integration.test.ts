import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { getConfig } from '../../../config/environment-config'
import { __removeAllAuthUsersFromSupabase, buildTestApp } from '../../../test/test-utils'
import { MockTelegramApi, MockTelegramApiInterface } from '../../../transport/third-party/telegram/telegram-api'
import { __deleteAllTelegramPairNonces } from '../../../transport/database/telegram-pair-nonces/telegram-pair-nonces-repository'
import {
  __deleteAllTelegramPendingImports,
  TelegramPendingImportsRepository,
} from '../../../transport/database/telegram-pending-imports/telegram-pending-imports-repository'

const SECRET_HEADER = 'x-telegram-bot-api-secret-token'

let nextChatId = 900_000
const freshChatId = () => nextChatId++

const textUpdate = (chatId: number, text: string) => ({
  update_id: 1,
  message: {
    message_id: 1,
    chat: { id: chatId, type: 'private' },
    from: { id: 42 },
    text,
  },
})

// The webhook acks 200 before processing; poll the mock until the async
// handler has replied (or the timeout proves it never did).
const waitForSentMessages = async (telegramApi: MockTelegramApiInterface, count: number): Promise<void> => {
  const deadline = Date.now() + 5_000
  while (telegramApi.sentMessages.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  expect(telegramApi.sentMessages.length).toBeGreaterThanOrEqual(count)
}

describe('telegram-webhook-router', () => {
  beforeEach(async () => {
    await __removeAllAuthUsersFromSupabase()
    await __deleteAllTelegramPairNonces()
    await __deleteAllTelegramPendingImports()
  })

  afterAll(async () => {
    await __removeAllAuthUsersFromSupabase()
    await __deleteAllTelegramPairNonces()
    await __deleteAllTelegramPendingImports()
  })

  it('returns 401 when the secret token header is missing', async () => {
    const testApp = buildTestApp()
    const response = await request(testApp).post('/api/v1/telegram/webhook').send(textUpdate(freshChatId(), 'Привет'))
    expect(response.status).toBe(401)
  })

  it('returns 401 when the secret token header is wrong', async () => {
    const testApp = buildTestApp()
    const response = await request(testApp)
      .post('/api/v1/telegram/webhook')
      .set(SECRET_HEADER, 'wrong-secret')
      .send(textUpdate(freshChatId(), 'Привет'))
    expect(response.status).toBe(401)
  })

  it('replies with a pairing link and stashes the message for an unknown chat', async () => {
    const telegramApi = MockTelegramApi()
    const testApp = buildTestApp({ telegramApi })
    const chatId = freshChatId()

    const response = await request(testApp)
      .post('/api/v1/telegram/webhook')
      .set(SECRET_HEADER, getConfig().telegramWebhookSecret)
      .send(textUpdate(chatId, 'Привет мир, как дела?'))
    expect(response.status).toBe(200)

    await waitForSentMessages(telegramApi, 1)
    expect(telegramApi.sentMessages[0].chatId).toBe(String(chatId))
    expect(telegramApi.sentMessages[0].text).toMatch(/\/telegram-pair\?nonce=[0-9a-f-]{36}/)

    const pending = await TelegramPendingImportsRepository().popForChat(String(chatId))
    expect(pending?.message_text).toBe('Привет мир, как дела?')
    expect(pending?.suggested_title).toBe('Привет мир, как дела?')
  })

  it('keeps the same pairing nonce across repeated messages from the same chat', async () => {
    const telegramApi = MockTelegramApi()
    const testApp = buildTestApp({ telegramApi })
    const chatId = freshChatId()

    const send = () =>
      request(testApp)
        .post('/api/v1/telegram/webhook')
        .set(SECRET_HEADER, getConfig().telegramWebhookSecret)
        .send(textUpdate(chatId, 'Привет мир'))

    await send()
    await waitForSentMessages(telegramApi, 1)
    await send()
    await waitForSentMessages(telegramApi, 2)

    const extractNonce = (text: string) => text.match(/nonce=([0-9a-f-]{36})/)?.[1]
    expect(extractNonce(telegramApi.sentMessages[0].text)).toBeDefined()
    expect(extractNonce(telegramApi.sentMessages[0].text)).toBe(extractNonce(telegramApi.sentMessages[1].text))
  })
})
