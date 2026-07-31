import { describe, expect, test } from 'vitest'
import {
  __createUserInSupabaseAndGetHisIdAndToken,
  __generateUniqueId,
  __getAnonymousSupabaseToken,
} from '../../../test/test-utils'
import { getConfig } from '../../../config/environment-config'
import { sql } from '../postgres-client'
import { StudySessionsRepository } from '../study-sessions/study-sessions-repository'
import {
  assertGuestLessonBatchQuota,
  assertGuestSessionQuota,
  assertGuestSourceQuota,
  GuestSourceLimitError,
} from './guest-source-quota'

const limit = getConfig().maxSourcesPerGuest

// A source with a track, owned by `creatorId`; the guest enters it into their
// library by attaching a live study session.
const insertSourceWithTrack = async (creatorId: string, type: 'movie' | 'adhoc' = 'movie', language = 'de') => {
  const sourceRows = (await sql`
    INSERT INTO public.content_sources (type, title, language, metadata, created_by_user_id)
    VALUES (${type}, ${__generateUniqueId('guest-quota-source')}, ${language}, '{}'::jsonb, ${creatorId})
    RETURNING id
  `) as { id: string }[]
  const sourceId = sourceRows[0]!.id
  const trackRows = (await sql`
    INSERT INTO public.text_tracks (content_source_id, source, language, external_id, hash)
    VALUES (${sourceId}, 'paste', ${language}, NULL, ${__generateUniqueId('guest-quota-track')})
    RETURNING id
  `) as { id: string }[]
  return { sourceId, trackId: trackRows[0]!.id }
}

const attachSession = async (userId: string, sourceId: string, trackId: string, language = 'de') => {
  const rows = (await sql`
    INSERT INTO public.study_sessions (
      user_id, content_source_id, text_track_id, native_language, target_language, cefr_level
    )
    VALUES (${userId}, ${sourceId}, ${trackId}, 'en', ${language}, 'B1')
    RETURNING id
  `) as { id: string }[]
  return rows[0]!.id
}

const fillLibrary = async (userId: string, creatorId: string, count: number) => {
  const attached: { sourceId: string; trackId: string; sessionId: string }[] = []
  for (let i = 0; i < count; i++) {
    const { sourceId, trackId } = await insertSourceWithTrack(creatorId)
    const sessionId = await attachSession(userId, sourceId, trackId)
    attached.push({ sourceId, trackId, sessionId })
  }
  return attached
}

describe('assertGuestSourceQuota integration tests', () => {
  test('regular accounts are never capped', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    await fillLibrary(userId, userId, limit + 1)

    await expect(assertGuestSourceQuota(userId)).resolves.toBeUndefined()
  })

  test('a guest passes below the cap and throws at it', async () => {
    const { id: userId } = await __getAnonymousSupabaseToken()
    const { id: creatorId } = await __createUserInSupabaseAndGetHisIdAndToken()

    await fillLibrary(userId, creatorId, limit - 1)
    await expect(assertGuestSourceQuota(userId)).resolves.toBeUndefined()

    await fillLibrary(userId, creatorId, 1)
    await expect(assertGuestSourceQuota(userId)).rejects.toBeInstanceOf(GuestSourceLimitError)
  })

  test('sessionless created sources do not consume slots', async () => {
    const { id: userId } = await __getAnonymousSupabaseToken()

    // Abandoned wizards leave source rows with no session — they must never
    // lock a guest out of the library.
    for (let i = 0; i < limit + 2; i++) {
      await insertSourceWithTrack(userId)
    }
    await expect(assertGuestSourceQuota(userId)).resolves.toBeUndefined()
  })

  test('adhoc sessions do not count toward the cap', async () => {
    const { id: userId } = await __getAnonymousSupabaseToken()

    const languages = ['de', 'fr', 'es']
    for (let i = 0; i < limit; i++) {
      const language = languages[i % languages.length]!
      const { sourceId, trackId } = await insertSourceWithTrack(userId, 'adhoc', language)
      await attachSession(userId, sourceId, trackId, language)
    }
    await expect(assertGuestSourceQuota(userId)).resolves.toBeUndefined()
  })
})

describe('assertGuestSessionQuota integration tests', () => {
  test('attached sources fill the library; deleting a session frees the slot', async () => {
    const { id: guestId } = await __getAnonymousSupabaseToken()
    const { id: creatorId } = await __createUserInSupabaseAndGetHisIdAndToken()

    const attached = await fillLibrary(guestId, creatorId, limit)

    // Library full: both creating a row and attaching a new source are blocked…
    const fresh = await insertSourceWithTrack(creatorId)
    await expect(assertGuestSourceQuota(guestId)).rejects.toBeInstanceOf(GuestSourceLimitError)
    await expect(assertGuestSessionQuota(guestId, fresh.sourceId)).rejects.toBeInstanceOf(GuestSourceLimitError)

    // …but a source with a live session re-attaches freely.
    await expect(assertGuestSessionQuota(guestId, attached[0]!.sourceId)).resolves.toBeUndefined()

    // Soft-deleting a session frees its slot.
    await sql`UPDATE public.study_sessions SET deleted_at = now() WHERE id = ${attached[0]!.sessionId}`
    await expect(assertGuestSourceQuota(guestId)).resolves.toBeUndefined()
    await expect(assertGuestSessionQuota(guestId, fresh.sourceId)).resolves.toBeUndefined()
  })
})

describe('assertGuestLessonBatchQuota integration tests', () => {
  const insertBatch = async (userId: string, status: 'extracting' | 'ready' | 'confirmed', expired = false) => {
    await sql`
      INSERT INTO public.import_batches (
        user_id, target_language, source_title, raw_text, input_hash, status, expires_at
      )
      VALUES (
        ${userId}, 'de', 'Lesson notes', 'der Tisch — the table',
        ${__generateUniqueId('guest-quota-batch')}, ${status},
        ${expired ? sql`now() - interval '1 day'` : sql`now() + interval '7 days'`}
      )
    `
  }

  test('live drafts are bounded; confirmed and expired drafts are free', async () => {
    const { id: guestId } = await __getAnonymousSupabaseToken()

    for (let i = 0; i < limit - 1; i++) {
      await insertBatch(guestId, 'extracting')
    }
    // Confirmed and expired drafts do not count.
    await insertBatch(guestId, 'confirmed')
    await insertBatch(guestId, 'ready', true)
    await expect(assertGuestLessonBatchQuota(guestId)).resolves.toBeUndefined()

    await insertBatch(guestId, 'ready')
    await expect(assertGuestLessonBatchQuota(guestId)).rejects.toBeInstanceOf(GuestSourceLimitError)
  })

  test('regular accounts are never bounded', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    for (let i = 0; i < limit + 1; i++) {
      await insertBatch(userId, 'extracting')
    }
    await expect(assertGuestLessonBatchQuota(userId)).resolves.toBeUndefined()
  })
})

describe('guest source quota in the ingest repositories', () => {
  const repository = StudySessionsRepository()

  const importedTextParams = (userId: string) => {
    const unique = __generateUniqueId('guest-quota-import')
    return {
      userId,
      type: 'text' as const,
      title: 'Imported text',
      sourceUrl: null,
      contentHash: unique,
      language: 'de',
      segments: [{ index: 0, text: `Der Tisch ist groß. ${unique}` }],
      nativeLanguage: 'en',
      targetLanguage: 'de',
      cefrLevel: 'B1',
      moderation: null,
    }
  }

  test('re-importing existing content at the cap resolves; new content throws', async () => {
    const { id: userId } = await __getAnonymousSupabaseToken()
    const { id: creatorId } = await __createUserInSupabaseAndGetHisIdAndToken()

    // One import through the repository (source + live session = one slot),
    // then foreign sessions to reach the cap exactly.
    const params = importedTextParams(userId)
    const first = await repository.getOrCreateForImportedText(params)
    await fillLibrary(userId, creatorId, limit - 1)

    const reimported = await repository.getOrCreateForImportedText(params)
    expect(reimported.contentSource.id).toBe(first.contentSource.id)

    await expect(repository.getOrCreateForImportedText(importedTextParams(userId))).rejects.toBeInstanceOf(
      GuestSourceLimitError
    )
  })

  test('adhoc session creation still works at the cap', async () => {
    const { id: userId } = await __getAnonymousSupabaseToken()
    const { id: creatorId } = await __createUserInSupabaseAndGetHisIdAndToken()
    await fillLibrary(userId, creatorId, limit)

    const { session } = await repository.getOrCreateAdhocStudySession({
      userId,
      targetLanguage: 'de',
      nativeLanguage: 'en',
      cefrLevel: 'B1',
      title: 'Saved words',
      trackHash: __generateUniqueId('guest-quota-adhoc'),
      contextBlob: 'Words saved outside a session.',
    })
    expect(session.user_id).toBe(userId)
  })
})
