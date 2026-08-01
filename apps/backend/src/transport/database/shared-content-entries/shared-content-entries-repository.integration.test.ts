import { describe, expect, test } from 'vitest'
import { __createUserInSupabaseAndGetHisIdAndToken, __generateUniqueId } from '../../../test/test-utils'
import { sql } from '../postgres-client'
import { SharedContentEntriesRepository } from './shared-content-entries-repository'

const repository = SharedContentEntriesRepository()

// Every fixture gets its own source + track (and usually its own fake
// language) so parallel test files on the shared never-reset DB can't collide.
const insertSourceWithTrack = async (params: {
  userId: string
  type?: 'youtube' | 'article' | 'text'
  language?: string
  title?: string
}) => {
  const language = params.language ?? 'de'
  const sourceRows = (await sql`
    INSERT INTO public.content_sources (type, title, language, metadata, created_by_user_id)
    VALUES (
      ${params.type ?? 'text'},
      ${params.title ?? __generateUniqueId('shared-repo-title')},
      ${language},
      '{}'::jsonb,
      ${params.userId}
    )
    RETURNING id
  `) as { id: string }[]
  const sourceId = sourceRows[0]!.id
  const trackRows = (await sql`
    INSERT INTO public.text_tracks (content_source_id, source, language, external_id, hash)
    VALUES (${sourceId}, 'paste', ${language}, NULL, ${__generateUniqueId('shared-repo-hash')})
    RETURNING id
  `) as { id: string }[]
  return { sourceId, trackId: trackRows[0]!.id, language }
}

const publishParams = (
  fixture: { sourceId: string; trackId: string; language: string },
  userId: string,
  canonicalKey: string
) => ({
  contentSourceId: fixture.sourceId,
  textTrackId: fixture.trackId,
  canonicalKey,
  language: fixture.language,
  sharedByUserId: userId,
})

describe('shared-content-entries-repository', () => {
  test('publish is idempotent per track and a pre-existing unshared row blocks publishing', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const fixture = await insertSourceWithTrack({ userId })
    const key = __generateUniqueId('key')

    const first = await repository.insertIfPublishable(publishParams(fixture, userId, key))
    expect(first).not.toBeNull()
    const second = await repository.insertIfPublishable(publishParams(fixture, userId, key))
    expect(second).toBeNull()

    // A different track whose owner opted out BEFORE any publish landed: the
    // upsert creates the opt-out row, and the later publish must not undo it.
    const optedOut = await insertSourceWithTrack({ userId })
    const optOutKey = __generateUniqueId('key')
    await repository.upsertUnshared(publishParams(optedOut, userId, optOutKey))
    const afterOptOut = await repository.insertIfPublishable(publishParams(optedOut, userId, optOutKey))
    expect(afterOptOut).toBeNull()
    const entry = await repository.findByTextTrackId(optedOut.trackId)
    expect(entry?.unshared_at).not.toBeNull()
  })

  test('canonical key dedups across users, a tombstone sticks across copies, a mere unshare does not', async () => {
    const { id: userA } = await __createUserInSupabaseAndGetHisIdAndToken()
    const { id: userB } = await __createUserInSupabaseAndGetHisIdAndToken()
    const key = __generateUniqueId('key')

    const fixtureA = await insertSourceWithTrack({ userId: userA })
    const fixtureB = await insertSourceWithTrack({ userId: userB })

    const entryA = await repository.insertIfPublishable(publishParams(fixtureA, userA, key))
    expect(entryA).not.toBeNull()

    // Same canonical content already live under user A → user B's publish no-ops.
    expect(await repository.insertIfPublishable(publishParams(fixtureB, userB, key))).toBeNull()

    // A unshares → the same content may be shared by B now.
    await repository.upsertUnshared(publishParams(fixtureA, userA, key))
    const entryB = await repository.insertIfPublishable(publishParams(fixtureB, userB, key))
    expect(entryB).not.toBeNull()

    // Admin tombstone on B's copy → no future copy of this content, from anyone.
    expect(await repository.removeAsAdmin(entryB!.id, 'copyright')).not.toBeNull()
    const fixtureC = await insertSourceWithTrack({ userId: userA })
    expect(await repository.insertIfPublishable(publishParams(fixtureC, userA, key))).toBeNull()
  })

  test('reshare distinguishes unshared, tombstoned, and unknown tracks', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const fixture = await insertSourceWithTrack({ userId })
    const key = __generateUniqueId('key')

    expect(await repository.reshare(fixture.trackId)).toBe('no-entry')

    const entry = await repository.insertIfPublishable(publishParams(fixture, userId, key))
    await repository.upsertUnshared(publishParams(fixture, userId, key))
    expect(await repository.reshare(fixture.trackId)).toBe('reshared')
    expect((await repository.findByTextTrackId(fixture.trackId))?.unshared_at).toBeNull()

    await repository.removeAsAdmin(entry!.id, 'spam')
    expect(await repository.reshare(fixture.trackId)).toBe('tombstoned')
  })

  test('reshare reports a canonical conflict when someone else went live in the meantime', async () => {
    const { id: userA } = await __createUserInSupabaseAndGetHisIdAndToken()
    const { id: userB } = await __createUserInSupabaseAndGetHisIdAndToken()
    const key = __generateUniqueId('key')

    const fixtureA = await insertSourceWithTrack({ userId: userA })
    await repository.insertIfPublishable(publishParams(fixtureA, userA, key))
    await repository.upsertUnshared(publishParams(fixtureA, userA, key))

    const fixtureB = await insertSourceWithTrack({ userId: userB })
    await repository.insertIfPublishable(publishParams(fixtureB, userB, key))

    expect(await repository.reshare(fixtureA.trackId)).toBe('canonical-conflict')
  })

  test('listLive filters by language and featured, orders featured first, and hides dead entries', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    // A per-test fake language makes list assertions immune to parallel rows.
    const language = __generateUniqueId('lang')

    const plain = await insertSourceWithTrack({ userId, language })
    const featured = await insertSourceWithTrack({ userId, language })
    const dead = await insertSourceWithTrack({ userId, language })

    const plainEntry = await repository.insertIfPublishable(publishParams(plain, userId, __generateUniqueId('key')))
    const featuredEntry = await repository.insertIfPublishable(
      publishParams(featured, userId, __generateUniqueId('key'))
    )
    const deadKey = __generateUniqueId('key')
    await repository.insertIfPublishable(publishParams(dead, userId, deadKey))
    await repository.upsertUnshared(publishParams(dead, userId, deadKey))
    await repository.setFeatured(featuredEntry!.id, true)

    const all = await repository.listLive({ language, featuredOnly: false, limit: 100 })
    expect(all.map((row) => row.id)).toEqual([featuredEntry!.id, plainEntry!.id])
    expect(all[0]!.title).toBeTruthy()

    const featuredOnly = await repository.listLive({ language, featuredOnly: true, limit: 100 })
    expect(featuredOnly.map((row) => row.id)).toEqual([featuredEntry!.id])
  })

  test('bulk unshares: per source, per user, and per user+track', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const language = __generateUniqueId('lang')

    const one = await insertSourceWithTrack({ userId, language })
    const two = await insertSourceWithTrack({ userId, language })
    await repository.insertIfPublishable(publishParams(one, userId, __generateUniqueId('key')))
    await repository.insertIfPublishable(publishParams(two, userId, __generateUniqueId('key')))

    await repository.unshareLiveForUserAndTrack(userId, one.trackId)
    expect((await repository.listLive({ language, featuredOnly: false, limit: 100 })).map((row) => row.id)).toEqual([
      (await repository.findByTextTrackId(two.trackId))!.id,
    ])

    await repository.unshareAllLiveForSource(two.sourceId)
    expect(await repository.listLive({ language, featuredOnly: false, limit: 100 })).toEqual([])

    const three = await insertSourceWithTrack({ userId, language })
    await repository.insertIfPublishable(publishParams(three, userId, __generateUniqueId('key')))
    await repository.unshareAllLiveForUser(userId)
    expect(await repository.listLive({ language, featuredOnly: false, limit: 100 })).toEqual([])
  })
})
