import { describe, expect, it } from 'vitest'
import request from 'supertest'
import {
  __createOrGetUserWithOurApi,
  __createUserInSupabaseAndGetHisIdAndToken,
  __generateUniqueTelegramChatId,
  __getAnonymousSupabaseToken,
  buildAuthorizationHeaders,
  buildTestApp,
} from '../../test/test-utils'
import { MockTelegramApi } from '../../transport/third-party/telegram/telegram-api'
import { TelegramPairNoncesRepository } from '../../transport/database/telegram-pair-nonces/telegram-pair-nonces-repository'
import { UsersRepository } from '../../transport/database/users/users-repository'

// Chat ids key the shared pair-nonces table, which is never wiped — a reused
// id would resolve to another test's (or a previous run's) nonce.
const freshChatId = () => String(__generateUniqueTelegramChatId())

const claimRequest = (testApp: ReturnType<typeof buildTestApp>, token: string, nonce: string) =>
  request(testApp).post('/api/v1/telegram-pair/claim').set(buildAuthorizationHeaders(token)).send({ nonce })

describe('telegram-pair-router', () => {
  it('rejects unauthenticated claims', async () => {
    const testApp = buildTestApp()
    const response = await request(testApp)
      .post('/api/v1/telegram-pair/claim')
      .send({ nonce: '00000000-0000-0000-0000-000000000001' })
    expect(response.status).toBe(401)
  })

  it('pairs the chat, confirms in Telegram, and rejects a second claim of the same nonce', async () => {
    const telegramApi = MockTelegramApi()
    const testApp = buildTestApp({ telegramApi })
    const { id: userId, token } = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token, referral: null })

    const chatId = freshChatId()
    const nonce = await TelegramPairNoncesRepository().getOrCreateForChat(chatId, null, 3600)

    const response = await claimRequest(testApp, token, nonce)
    expect(response.status).toBe(200)
    expect(response.body.data).toEqual({ paired: true })
    expect(await UsersRepository().getTelegramChatId(userId)).toBe(chatId)
    expect(await UsersRepository().findUserIdByTelegramChatId(chatId)).toBe(userId)
    expect(telegramApi.sentMessages.some((m) => m.chatId === chatId && m.text.includes('Connected'))).toBe(true)

    const secondClaim = await claimRequest(testApp, token, nonce)
    expect(secondClaim.status).toBe(400)
  })

  it('rejects an anonymous (guest) claim without burning the nonce', async () => {
    // Anonymous tokens only pass the auth middleware with the kill switch on;
    // pin it so this test doesn't depend on the test environment's env var.
    const testApp = buildTestApp({ telegramApi: MockTelegramApi(), isGuestModeEnabled: true })
    const { token: guestToken } = await __getAnonymousSupabaseToken()
    const nonce = await TelegramPairNoncesRepository().getOrCreateForChat(freshChatId(), null, 3600)

    const guestClaim = await claimRequest(testApp, guestToken, nonce)
    expect(guestClaim.status).toBe(400)
    expect(guestClaim.body.data.errors[0].message).toBe('Create an account before connecting Telegram')

    // The guard fires before the nonce is claimed, so a real account that
    // follows the same link after converting can still pair.
    const { token } = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token, referral: null })
    expect((await claimRequest(testApp, token, nonce)).status).toBe(200)
  })

  it('rejects an expired nonce', async () => {
    const testApp = buildTestApp({ telegramApi: MockTelegramApi() })
    const { token } = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token, referral: null })

    const nonce = await TelegramPairNoncesRepository().getOrCreateForChat(freshChatId(), null, -10)
    const response = await claimRequest(testApp, token, nonce)
    expect(response.status).toBe(400)
  })

  it('steals the chat from the previous owner on re-pair', async () => {
    const testApp = buildTestApp({ telegramApi: MockTelegramApi() })
    const chatId = freshChatId()

    const userA = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token: userA.token, referral: null })
    const nonceA = await TelegramPairNoncesRepository().getOrCreateForChat(chatId, null, 3600)
    expect((await claimRequest(testApp, userA.token, nonceA)).status).toBe(200)

    const userB = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token: userB.token, referral: null })
    const nonceB = await TelegramPairNoncesRepository().getOrCreateForChat(chatId, null, 3600)
    expect((await claimRequest(testApp, userB.token, nonceB)).status).toBe(200)

    expect(await UsersRepository().getTelegramChatId(userA.id)).toBeNull()
    expect(await UsersRepository().getTelegramChatId(userB.id)).toBe(chatId)
  })

  it('returns 409 and un-burns the nonce when the users row does not exist yet', async () => {
    const testApp = buildTestApp({ telegramApi: MockTelegramApi() })
    // Auth user exists but the public.users row was never created — the state
    // a fresh signup is in until UserSetupGate's createOrUpdateUser lands.
    const { token } = await __createUserInSupabaseAndGetHisIdAndToken()

    const nonce = await TelegramPairNoncesRepository().getOrCreateForChat(freshChatId(), null, 3600)
    const firstAttempt = await claimRequest(testApp, token, nonce)
    expect(firstAttempt.status).toBe(409)

    // Once the users row exists, the SAME nonce must still be claimable.
    await __createOrGetUserWithOurApi({ testApp, token, referral: null })
    const retry = await claimRequest(testApp, token, nonce)
    expect(retry.status).toBe(200)
  })

  it('completePending reports accepted=false when no chat is linked', async () => {
    const testApp = buildTestApp({ telegramApi: MockTelegramApi() })
    const { token } = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token, referral: null })

    const response = await request(testApp)
      .post('/api/v1/telegram-pair/complete-pending')
      .set(buildAuthorizationHeaders(token))
      .send({})
    expect(response.status).toBe(200)
    expect(response.body.data).toEqual({ accepted: false })
  })

  it('completePending reports accepted=true for a paired user', async () => {
    const testApp = buildTestApp({ telegramApi: MockTelegramApi() })
    const { token } = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token, referral: null })
    const nonce = await TelegramPairNoncesRepository().getOrCreateForChat(freshChatId(), null, 3600)
    expect((await claimRequest(testApp, token, nonce)).status).toBe(200)

    const response = await request(testApp)
      .post('/api/v1/telegram-pair/complete-pending')
      .set(buildAuthorizationHeaders(token))
      .send({})
    expect(response.status).toBe(200)
    expect(response.body.data).toEqual({ accepted: true })
  })
})
