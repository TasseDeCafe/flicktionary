import { createHash, randomUUID } from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { ERROR_CODE_FOR_GUEST_SOURCE_LIMIT_REACHED } from '@flicktionary/api-client/key-generation/frontend-api-key-constants'
import {
  __createOrGetUserWithOurApi,
  __createUserInSupabaseAndGetHisIdAndToken,
  __generateUniqueId,
  __getAnonymousSupabaseToken,
  buildTestApp,
} from '../../test/test-utils'
import { getConfig } from '../../config/environment-config'
import { sql } from '../../transport/database/postgres-client'
import { MockAnthropicPasses } from '../../transport/third-party/anthropic/anthropic-passes'
import type { ModerationVerdict } from '../../transport/third-party/anthropic/passes/moderation-pass'
import { UsersRepository } from '../../transport/database/users/users-repository'
import { UserTargetLanguagePrefsRepository } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'

const buildApp = (moderationPass: (chunk: string) => Promise<ModerationVerdict | null>) =>
  buildTestApp({ anthropicPasses: MockAnthropicPasses({ moderationPass: moderationPass as never }) })

const allowAll = vi.fn(async (): Promise<ModerationVerdict> => ({ verdict: 'allow' }))

const createReader = async (testApp: Express) => {
  const { id, token } = await __createUserInSupabaseAndGetHisIdAndToken()
  await __createOrGetUserWithOurApi({ testApp, token, referral: null })
  await UsersRepository().setNativeLanguage(id, 'en')
  await UserTargetLanguagePrefsRepository().upsertCefr(id, 'ru', 'B1')
  return { id, auth: { Authorization: `Bearer ${token}` } }
}

// Per-test unique text, so the per-user content hash never dedups across tests.
const buildParts = (count: number) => {
  const marker = randomUUID()
  return Array.from({ length: count }, (_, partIndex) => ({
    partIndex,
    title: `Глава ${partIndex + 1}`,
    segments: [`Глава ${partIndex + 1}`, `Первый абзац ${marker}.`, 'Второй абзац.'],
  }))
}

const hashParts = (parts: ReturnType<typeof buildParts>) =>
  createHash('sha256')
    .update(parts.map((part) => part.segments.join('\n')).join('\n\n'))
    .digest('hex')

const startUpload = async (testApp: Express, auth: Record<string, string>, parts: ReturnType<typeof buildParts>) =>
  request(testApp)
    .post('/api/v1/books')
    .set(auth)
    .send({
      title: 'Убик',
      author: 'Филип К. Дик',
      language: 'ru',
      fileName: 'ubik.fb2',
      contentHash: hashParts(parts),
      partCount: parts.length,
    })

describe('books-router', () => {
  test('returns 401 when unauthenticated', async () => {
    const response = await request(buildApp(allowAll))
      .post('/api/v1/books')
      .set({ Authorization: 'Bearer wrong-token' })
      .send({})
    expect(response.status).toBe(401)
  })

  test('golden path: upload in batches, finalize, list, open the next part, read, remove, re-upload', async () => {
    const testApp = buildApp(allowAll)
    const { auth } = await createReader(testApp)
    const parts = buildParts(3)

    const created = await startUpload(testApp, auth, parts)
    expect(created.status).toBe(200)
    const { contentSourceId, uploadId, alreadyExisted } = created.body.data
    expect(alreadyExisted).toBe(false)

    const first = await request(testApp)
      .post(`/api/v1/books/${contentSourceId}/parts`)
      .set(auth)
      .send({ uploadId, parts: parts.slice(0, 2) })
    expect(first.body.data.receivedPartCount).toBe(2)

    // Finalizing before every part arrived is refused and leaves the upload retryable.
    const early = await request(testApp).post(`/api/v1/books/${contentSourceId}/finalize`).set(auth).send({ uploadId })
    expect(early.status).toBe(400)

    // Re-sending an already-received part is a no-op.
    const second = await request(testApp)
      .post(`/api/v1/books/${contentSourceId}/parts`)
      .set(auth)
      .send({ uploadId, parts: parts.slice(1) })
    expect(second.body.data.receivedPartCount).toBe(3)

    const finalized = await request(testApp)
      .post(`/api/v1/books/${contentSourceId}/finalize`)
      .set(auth)
      .send({ uploadId })
    expect(finalized.status).toBe(200)
    const firstSessionId = finalized.body.data.sessionId

    // Finalize is idempotent.
    const again = await request(testApp).post(`/api/v1/books/${contentSourceId}/finalize`).set(auth).send({ uploadId })
    expect(again.body.data.sessionId).toBe(firstSessionId)

    const listed = await request(testApp).get('/api/v1/study-sessions').set(auth)
    const bookSession = listed.body.data.find((s: { id: string }) => s.id === firstSessionId)
    expect(bookSession).toMatchObject({
      contentSourceType: 'book',
      bookPartIndex: 0,
      bookPartTitle: 'Глава 1',
      bookPartCount: 3,
      bookAuthor: 'Филип К. Дик',
      lastReadAt: null,
    })

    const opened = await request(testApp).post(`/api/v1/books/${contentSourceId}/parts/1/open`).set(auth).send({})
    expect(opened.status).toBe(200)
    const secondSessionId = opened.body.data.sessionId
    const reopened = await request(testApp).post(`/api/v1/books/${contentSourceId}/parts/1/open`).set(auth).send({})
    expect(reopened.body.data.sessionId).toBe(secondSessionId)

    await request(testApp)
      .post(`/api/v1/study-sessions/${secondSessionId}/reading-progress`)
      .set(auth)
      .send({ segmentIndex: 1 })

    const book = await request(testApp).get(`/api/v1/books/${contentSourceId}`).set(auth)
    expect(book.status).toBe(200)
    expect(book.body.data).toMatchObject({ title: 'Убик', author: 'Филип К. Дик', language: 'ru', currentPartIndex: 1 })
    expect(book.body.data.parts).toHaveLength(3)
    expect(book.body.data.parts[1]).toMatchObject({
      partIndex: 1,
      title: 'Глава 2',
      segmentCount: 3,
      sessionId: secondSessionId,
      furthestReadSegmentIndex: 1,
    })
    expect(book.body.data.parts[2].sessionId).toBeNull()

    const removed = await request(testApp).delete(`/api/v1/books/${contentSourceId}`).set(auth)
    expect(removed.status).toBe(200)
    const afterRemove = await request(testApp).get('/api/v1/study-sessions').set(auth)
    expect(afterRemove.body.data.some((s: { contentSourceId: string }) => s.contentSourceId === contentSourceId)).toBe(
      false
    )

    // Re-uploading the same book resolves to it and opening starts a fresh session.
    const reupload = await startUpload(testApp, auth, parts)
    expect(reupload.body.data).toMatchObject({ contentSourceId, alreadyExisted: true, uploadId: null })
    const fresh = await request(testApp).post(`/api/v1/books/${contentSourceId}/parts/0/open`).set(auth).send({})
    expect(fresh.body.data.sessionId).not.toBe(firstSessionId)
  })

  test('an unfinished book cannot become a session, and paste into a book source is refused', async () => {
    const testApp = buildApp(allowAll)
    const { auth } = await createReader(testApp)
    const parts = buildParts(1)
    const { contentSourceId, uploadId } = (await startUpload(testApp, auth, parts)).body.data
    await request(testApp).post(`/api/v1/books/${contentSourceId}/parts`).set(auth).send({ uploadId, parts })

    const book = await request(testApp).get(`/api/v1/books/${contentSourceId}`).set(auth)
    expect(book.status).toBe(404)
    const opened = await request(testApp).post(`/api/v1/books/${contentSourceId}/parts/0/open`).set(auth).send({})
    expect(opened.status).toBe(404)

    const pasted = await request(testApp)
      .post('/api/v1/text-tracks/paste')
      .set(auth)
      .send({ contentSourceId, language: 'ru', text: 'Это достаточно длинный текст, чтобы пройти проверку длины.' })
    expect(pasted.status).toBe(400)
  })

  test('a restarted upload supersedes the old attempt, and starting another book discards it', async () => {
    const testApp = buildApp(allowAll)
    const { auth } = await createReader(testApp)
    const parts = buildParts(1)
    const oldAttempt = (await startUpload(testApp, auth, parts)).body.data
    const newAttempt = (await startUpload(testApp, auth, parts)).body.data
    expect(newAttempt.contentSourceId).toBe(oldAttempt.contentSourceId)
    expect(newAttempt.uploadId).not.toBe(oldAttempt.uploadId)

    const stale = await request(testApp)
      .post(`/api/v1/books/${oldAttempt.contentSourceId}/parts`)
      .set(auth)
      .send({ uploadId: oldAttempt.uploadId, parts })
    expect(stale.status).toBe(409)

    // One pending upload per user: a different book replaces this one.
    const otherBook = (await startUpload(testApp, auth, buildParts(2))).body.data
    expect(otherBook.contentSourceId).not.toBe(oldAttempt.contentSourceId)
    const gone = await request(testApp)
      .post(`/api/v1/books/${oldAttempt.contentSourceId}/parts`)
      .set(auth)
      .send({ uploadId: newAttempt.uploadId, parts })
    expect(gone.status).toBe(404)
  })

  test('a csam verdict on the sample deletes the book; sexual-explicit is accepted as flagged', async () => {
    const csamApp = buildApp(vi.fn(async (): Promise<ModerationVerdict> => ({ verdict: 'block', category: 'csam' })))
    const { auth } = await createReader(csamApp)
    const parts = buildParts(1)
    const { contentSourceId, uploadId } = (await startUpload(csamApp, auth, parts)).body.data
    await request(csamApp).post(`/api/v1/books/${contentSourceId}/parts`).set(auth).send({ uploadId, parts })
    const blocked = await request(csamApp)
      .post(`/api/v1/books/${contentSourceId}/finalize`)
      .set(auth)
      .send({ uploadId })
    expect(blocked.status).toBe(422)
    expect(blocked.body.data.errors[0].code).toBe('CONTENT_BLOCKED')
    const retry = await request(csamApp).post(`/api/v1/books/${contentSourceId}/finalize`).set(auth).send({ uploadId })
    expect(retry.status).toBe(404)

    const explicitApp = buildApp(
      vi.fn(async (): Promise<ModerationVerdict> => ({ verdict: 'block', category: 'sexual-explicit' }))
    )
    const reader = await createReader(explicitApp)
    const novel = buildParts(1)
    const upload = (await startUpload(explicitApp, reader.auth, novel)).body.data
    await request(explicitApp)
      .post(`/api/v1/books/${upload.contentSourceId}/parts`)
      .set(reader.auth)
      .send({ uploadId: upload.uploadId, parts: novel })
    const accepted = await request(explicitApp)
      .post(`/api/v1/books/${upload.contentSourceId}/finalize`)
      .set(reader.auth)
      .send({ uploadId: upload.uploadId })
    expect(accepted.status).toBe(200)
  })

  test('finalize without a CEFR level for the book language is a precondition failure', async () => {
    const testApp = buildApp(allowAll)
    const { id, token } = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token, referral: null })
    await UsersRepository().setNativeLanguage(id, 'en')
    const auth = { Authorization: `Bearer ${token}` }
    const parts = buildParts(1)
    const { contentSourceId, uploadId } = (await startUpload(testApp, auth, parts)).body.data
    await request(testApp).post(`/api/v1/books/${contentSourceId}/parts`).set(auth).send({ uploadId, parts })
    const response = await request(testApp)
      .post(`/api/v1/books/${contentSourceId}/finalize`)
      .set(auth)
      .send({ uploadId })
    expect(response.status).toBe(412)
    expect(response.body.data.errors[0].code).toBe('cefr_not_set')
  })

  test('finalize with a superseded uploadId is refused without committing', async () => {
    const testApp = buildApp(allowAll)
    const { auth } = await createReader(testApp)
    const parts = buildParts(1)
    const oldAttempt = (await startUpload(testApp, auth, parts)).body.data
    const newAttempt = (await startUpload(testApp, auth, parts)).body.data
    await request(testApp)
      .post(`/api/v1/books/${newAttempt.contentSourceId}/parts`)
      .set(auth)
      .send({ uploadId: newAttempt.uploadId, parts })

    const stale = await request(testApp)
      .post(`/api/v1/books/${oldAttempt.contentSourceId}/finalize`)
      .set(auth)
      .send({ uploadId: oldAttempt.uploadId })
    expect(stale.status).toBe(409)
    expect(stale.body.data.errors[0].code).toBe('BOOK_UPLOAD_SUPERSEDED')

    const current = await request(testApp)
      .post(`/api/v1/books/${newAttempt.contentSourceId}/finalize`)
      .set(auth)
      .send({ uploadId: newAttempt.uploadId })
    expect(current.status).toBe(200)
  })

  test('an unfinished book cannot get a session through studySessions.create, nor tracks through SRT/OpenSubtitles', async () => {
    const downloadSrt = vi.fn()
    const testApp = buildTestApp({
      anthropicPasses: MockAnthropicPasses({ moderationPass: allowAll as never }),
      openSubtitlesDownloadSrt: downloadSrt,
    })
    const { auth } = await createReader(testApp)
    const parts = buildParts(1)
    const { contentSourceId, uploadId } = (await startUpload(testApp, auth, parts)).body.data
    await request(testApp).post(`/api/v1/books/${contentSourceId}/parts`).set(auth).send({ uploadId, parts })
    const tracks = (await sql`
      SELECT id FROM public.text_tracks WHERE content_source_id = ${contentSourceId}
    `) as { id: string }[]

    const session = await request(testApp).post('/api/v1/study-sessions').set(auth).send({
      contentSourceId,
      textTrackId: tracks[0]!.id,
      nativeLanguage: 'en',
      targetLanguage: 'ru',
      cefrLevel: 'B1',
    })
    expect(session.status).toBe(400)

    const srt = await request(testApp)
      .post('/api/v1/text-tracks/upload')
      .set(auth)
      .send({ contentSourceId, language: 'ru', srtContent: '1\n00:00:01,000 --> 00:00:02,000\nПривет\n' })
    expect(srt.status).toBe(400)

    const openSubtitles = await request(testApp)
      .post('/api/v1/text-tracks/opensubtitles/import')
      .set(auth)
      .send({ contentSourceId, fileId: 1, language: 'ru' })
    expect(openSubtitles.status).toBe(400)
    expect(downloadSrt).not.toHaveBeenCalled()
  })

  describe('guest library cap', () => {
    const limit = getConfig().maxSourcesPerGuest
    const guestApp = buildTestApp({
      anthropicPasses: MockAnthropicPasses({ moderationPass: allowAll as never }),
      isGuestModeEnabled: true,
    })

    const createGuestReader = async () => {
      const { id, token } = await __getAnonymousSupabaseToken()
      await __createOrGetUserWithOurApi({ testApp: guestApp, token, referral: null })
      await UsersRepository().setNativeLanguage(id, 'en')
      await UserTargetLanguagePrefsRepository().upsertCefr(id, 'ru', 'B1')
      return { id, auth: { Authorization: `Bearer ${token}` } }
    }

    // Fills one library slot: a live session on a fresh source the guest owns.
    const fillLibrarySlot = async (userId: string) => {
      const sources = (await sql`
        INSERT INTO public.content_sources (type, title, language, metadata, created_by_user_id)
        VALUES ('text', ${__generateUniqueId('guest-book-cap')}, 'ru', '{}'::jsonb, ${userId})
        RETURNING id
      `) as { id: string }[]
      const tracks = (await sql`
        INSERT INTO public.text_tracks (content_source_id, source, language, external_id, hash)
        VALUES (${sources[0]!.id}, 'paste', 'ru', NULL, ${__generateUniqueId('guest-book-cap-track')})
        RETURNING id
      `) as { id: string }[]
      await sql`
        INSERT INTO public.study_sessions (user_id, content_source_id, text_track_id, native_language, target_language, cefr_level)
        VALUES (${userId}, ${sources[0]!.id}, ${tracks[0]!.id}, 'en', 'ru', 'B1')
      `
    }

    test('a guest with a full library is refused before uploading anything', async () => {
      const guest = await createGuestReader()
      for (let i = 0; i < limit; i++) await fillLibrarySlot(guest.id)
      const response = await startUpload(guestApp, guest.auth, buildParts(1))
      expect(response.status).toBe(403)
      expect(response.body.data.errors[0].code).toBe(ERROR_CODE_FOR_GUEST_SOURCE_LIMIT_REACHED)
    })

    test('a library that filled up during the upload refuses finalize and leaves the book retryable', async () => {
      const guest = await createGuestReader()
      for (let i = 0; i < limit - 1; i++) await fillLibrarySlot(guest.id)
      const parts = buildParts(1)
      const { contentSourceId, uploadId } = (await startUpload(guestApp, guest.auth, parts)).body.data
      await request(guestApp).post(`/api/v1/books/${contentSourceId}/parts`).set(guest.auth).send({ uploadId, parts })
      await fillLibrarySlot(guest.id)

      const refused = await request(guestApp)
        .post(`/api/v1/books/${contentSourceId}/finalize`)
        .set(guest.auth)
        .send({ uploadId })
      expect(refused.status).toBe(403)
      expect(refused.body.data.errors[0].code).toBe(ERROR_CODE_FOR_GUEST_SOURCE_LIMIT_REACHED)

      // Nothing committed: the book is still uploading, so it isn't readable.
      const book = await request(guestApp).get(`/api/v1/books/${contentSourceId}`).set(guest.auth)
      expect(book.status).toBe(404)

      // Freeing a slot makes the same finalize succeed.
      await sql`
        UPDATE public.study_sessions SET deleted_at = NOW()
        WHERE id = (
          SELECT id FROM public.study_sessions
          WHERE user_id = ${guest.id} AND deleted_at IS NULL
          ORDER BY created_at DESC LIMIT 1
        )
      `
      const retried = await request(guestApp)
        .post(`/api/v1/books/${contentSourceId}/finalize`)
        .set(guest.auth)
        .send({ uploadId })
      expect(retried.status).toBe(200)
    })
  })
})
