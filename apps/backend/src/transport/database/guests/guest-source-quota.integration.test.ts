import { describe, expect, test } from 'vitest'
import {
  __createUserInSupabaseAndGetHisIdAndToken,
  __generateUniqueId,
  __getAnonymousSupabaseToken,
} from '../../../test/test-utils'
import { getConfig } from '../../../config/environment-config'
import { sql } from '../postgres-client'
import { StudySessionsRepository } from '../study-sessions/study-sessions-repository'
import { assertGuestSessionQuota, assertGuestSourceQuota, GuestSourceLimitError } from './guest-source-quota'

const limit = getConfig().maxSourcesPerGuest

const insertSources = async (userId: string, count: number, type: 'text' | 'adhoc' = 'text') => {
  // Adhoc sources are unique per (user, language) — vary the language so more
  // than one row can exist for the same user.
  const languages = ['de', 'fr', 'es', 'it', 'pt', 'ru']
  for (let i = 0; i < count; i++) {
    await sql`
      INSERT INTO public.content_sources (type, title, language, metadata, created_by_user_id)
      VALUES (${type}, ${__generateUniqueId('guest-quota-source')}, ${type === 'adhoc' ? languages[i % languages.length] : 'de'}, '{}'::jsonb, ${userId})
    `
  }
}

describe('assertGuestSourceQuota integration tests', () => {
  test('regular accounts are never capped', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    await insertSources(userId, limit + 1)

    await expect(assertGuestSourceQuota(userId)).resolves.toBeUndefined()
  })

  test('a guest passes below the cap and throws at it', async () => {
    const { id: userId } = await __getAnonymousSupabaseToken()

    await insertSources(userId, limit - 1)
    await expect(assertGuestSourceQuota(userId)).resolves.toBeUndefined()

    await insertSources(userId, 1)
    await expect(assertGuestSourceQuota(userId)).rejects.toBeInstanceOf(GuestSourceLimitError)
  })

  test('adhoc sources do not count toward the cap', async () => {
    const { id: userId } = await __getAnonymousSupabaseToken()
    await insertSources(userId, limit, 'adhoc')

    await expect(assertGuestSourceQuota(userId)).resolves.toBeUndefined()
  })
})

// The library also counts globally-deduped sources the guest merely attached
// via a session (created by someone else): "adding" Breaking Bad episodes
// another user registered creates no rows, but each episode still takes a
// library slot at session creation.
describe('assertGuestSessionQuota integration tests', () => {
  // A source owned by another user, with a track, optionally attached to the
  // guest through a live study session.
  const insertForeignSource = async (creatorId: string) => {
    const sourceRows = (await sql`
      INSERT INTO public.content_sources (type, title, language, metadata, created_by_user_id)
      VALUES ('movie', ${__generateUniqueId('guest-quota-foreign')}, 'de', '{}'::jsonb, ${creatorId})
      RETURNING id
    `) as { id: string }[]
    const sourceId = sourceRows[0]!.id
    const trackRows = (await sql`
      INSERT INTO public.text_tracks (content_source_id, source, language, external_id, hash)
      VALUES (${sourceId}, 'paste', 'de', NULL, ${__generateUniqueId('guest-quota-track')})
      RETURNING id
    `) as { id: string }[]
    return { sourceId, trackId: trackRows[0]!.id }
  }

  const attachSession = async (userId: string, sourceId: string, trackId: string) => {
    const rows = (await sql`
      INSERT INTO public.study_sessions (
        user_id, content_source_id, text_track_id, native_language, target_language, cefr_level
      )
      VALUES (${userId}, ${sourceId}, ${trackId}, 'en', 'de', 'B1')
      RETURNING id
    `) as { id: string }[]
    return rows[0]!.id
  }

  test('attached foreign sources fill the library; deleting a session frees the slot', async () => {
    const { id: guestId } = await __getAnonymousSupabaseToken()
    const { id: creatorId } = await __createUserInSupabaseAndGetHisIdAndToken()

    const attached: { sourceId: string; trackId: string; sessionId: string }[] = []
    for (let i = 0; i < limit; i++) {
      const foreign = await insertForeignSource(creatorId)
      const sessionId = await attachSession(guestId, foreign.sourceId, foreign.trackId)
      attached.push({ ...foreign, sessionId })
    }

    // Library full via sessions alone: both creating a row and attaching a
    // new source are blocked…
    const fresh = await insertForeignSource(creatorId)
    await expect(assertGuestSourceQuota(guestId)).rejects.toBeInstanceOf(GuestSourceLimitError)
    await expect(assertGuestSessionQuota(guestId, fresh.sourceId)).rejects.toBeInstanceOf(GuestSourceLimitError)

    // …but a source already in the library re-attaches freely.
    await expect(assertGuestSessionQuota(guestId, attached[0]!.sourceId)).resolves.toBeUndefined()

    // Soft-deleting a session frees the slot of a source the guest didn't create.
    await sql`UPDATE public.study_sessions SET deleted_at = now() WHERE id = ${attached[0]!.sessionId}`
    await expect(assertGuestSourceQuota(guestId)).resolves.toBeUndefined()
    await expect(assertGuestSessionQuota(guestId, fresh.sourceId)).resolves.toBeUndefined()
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

    // One import through the repository (counts toward the cap), then direct
    // rows to reach it exactly.
    const params = importedTextParams(userId)
    const first = await repository.getOrCreateForImportedText(params)
    await insertSources(userId, limit - 1)

    const reimported = await repository.getOrCreateForImportedText(params)
    expect(reimported.contentSource.id).toBe(first.contentSource.id)

    await expect(repository.getOrCreateForImportedText(importedTextParams(userId))).rejects.toBeInstanceOf(
      GuestSourceLimitError
    )
  })

  test('adhoc session creation still works at the cap', async () => {
    const { id: userId } = await __getAnonymousSupabaseToken()
    await insertSources(userId, limit)

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
