import { describe, expect, test } from 'vitest'
import { __createUserInSupabaseAndGetHisIdAndToken, __generateUniqueId } from '../../test/test-utils'
import { sql } from '../../transport/database/postgres-client'
import { UserLookupsRepository, type ChunksCursor } from '../../transport/database/user-lookups/user-lookups-repository'
import { StudyFacetsRepository } from '../../transport/database/study-facets/study-facets-repository'
import { BookPinsRepository } from '../../transport/database/book-pins/book-pins-repository'
import { UserTargetLanguagePrefsRepository } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { introductionOrderCtesSql } from './book-priority'
import { resolveBookQuota } from './book-quota'
import { TRACK_LEMMA_PROFILE_VERSION } from '../lemma-profiles/build-track-lemma-profile'

// The pinned-book introduction order against a real DB (docs/SRS.md §4
// "Pinned book"): the interleave and quota overflow, the production and
// threshold exclusions, the reading-position maths, bridge-pending slotting
// in Up next, and the introduction-time quota stamp.
describe('pinned-book introduction order', () => {
  const userLookupsRepository = UserLookupsRepository()
  const bookPinsRepository = BookPinsRepository()
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

  // A never-introduced recognition term (fresh single save, tier 2); zipf
  // controls its position in the normal tier order.
  const makeTerm = async (userId: string, headword: string, zipf: number) => {
    const lookup = await userLookupsRepository.findOrCreate({ userId, targetLanguage: 'ru', headword, sense: 'x' })
    await sql`
      UPDATE public.user_lookups
      SET count = 1, encounter_count = 1, last_encountered_at = ${daysAgo(2)}, zipf_estimate = ${zipf},
          created_at = ${daysAgo(10)}
      WHERE id = ${lookup.id}
    `
    await sql`
      INSERT INTO public.study_facets (user_lookup_id, user_id, target_language, skill, target_form, srs_state, data_status)
      VALUES (${lookup.id}, ${userId}, 'ru', 'meaning_recognition', '', NULL, 'ready')
    `
    return lookup.id
  }

  const addProductionFacet = async (userId: string, userLookupId: string, srsState: 'review' | null) => {
    await sql`
      INSERT INTO public.study_facets (user_lookup_id, user_id, target_language, skill, target_form, srs_state,
        srs_due, data_status)
      VALUES (${userLookupId}, ${userId}, 'ru', 'meaning_production', '', ${srsState},
        ${srsState ? daysAgo(-5) : null}, 'ready')
    `
  }

  // A ready book whose parts carry the given per-lemma counts (10 segments
  // each, profiles stamped as built).
  const makeBook = async (userId: string, parts: Array<Record<string, number>>) => {
    const [source] = (await sql`
      INSERT INTO public.content_sources (type, title, language, metadata, created_by_user_id)
      VALUES ('book', 'book', 'ru',
        ${sql.json({ importStatus: 'ready', contentHash: __generateUniqueId('hash') })}, ${userId})
      RETURNING id
    `) as [{ id: string }]
    const trackIds: string[] = []
    for (const [index, counts] of parts.entries()) {
      const [track] = (await sql`
        INSERT INTO public.text_tracks (content_source_id, source, language, external_id, hash, book_part_index,
          book_part_title, profile_built_at, profile_segment_count, profile_version)
        VALUES (${source.id}, 'upload', 'ru', NULL, ${__generateUniqueId('part')}, ${index}, ${`Part ${index}`},
          NOW(), 10, ${TRACK_LEMMA_PROFILE_VERSION})
        RETURNING id
      `) as [{ id: string }]
      for (const [lemma, occurrences] of Object.entries(counts)) {
        await sql`
          INSERT INTO public.book_part_lemma_counts (text_track_id, lemma, occurrences)
          VALUES (${track.id}, ${lemma}, ${occurrences})
        `
      }
      trackIds.push(track.id)
    }
    return { sourceId: source.id, trackIds }
  }

  const readTo = async (userId: string, sourceId: string, trackId: string, furthest: number) => {
    await sql`
      INSERT INTO public.study_sessions (user_id, content_source_id, text_track_id, native_language, target_language,
        cefr_level, furthest_read_segment_index, last_read_at)
      VALUES (${userId}, ${sourceId}, ${trackId}, 'en', 'ru', 'B1', ${furthest}, NOW())
    `
  }

  const introOrder = async (userId: string, bookRemaining: number) =>
    (await sql`
      WITH ${introductionOrderCtesSql({ userId, targetLanguage: 'ru', bookRemaining })}
      SELECT id, boosted, book_ahead::float AS book_ahead FROM intro_order
      ORDER BY intro_pos, intro_lane, intro_seq
    `) as Array<{ id: string; boosted: boolean; book_ahead: number }>

  test('interleaves the book stream up to the quota; overflow, production-marked and rare-ahead terms stay normal', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const n1 = await makeTerm(userId, 'нормаодин', 6.0)
    const b3 = await makeTerm(userId, 'книгатри', 5.2)
    const bridgePending = await makeTerm(userId, 'мосток', 5.1)
    await addProductionFacet(userId, bridgePending, 'review')
    const n2 = await makeTerm(userId, 'нормадва', 5.0)
    const rareAhead = await makeTerm(userId, 'редко', 4.9)
    const productionMarked = await makeTerm(userId, 'продакшн', 4.8)
    await addProductionFacet(userId, productionMarked, null)
    const n3 = await makeTerm(userId, 'нормтри', 4.5)
    const b1 = await makeTerm(userId, 'книгаодин', 4.0)
    const b2 = await makeTerm(userId, 'книгадва', 3.9)
    const { sourceId } = await makeBook(userId, [
      { книгаодин: 10, книгадва: 6, книгатри: 4, редко: 2, продакшн: 20, мосток: 30 },
    ])
    await bookPinsRepository.upsertPin({ userId, targetLanguage: 'ru', contentSourceId: sourceId })

    const discovery = await userLookupsRepository.listEligibleNewCitationFacets({
      userId,
      targetLanguage: 'ru',
      pool: 'recognition',
      bookRemaining: 2,
    })
    // B N B N…: b1, b2 boosted; b3 (past the quota) keeps its tier slot.
    expect(discovery).toEqual([b1, n1, b2, b3, n2, rareAhead, productionMarked, n3])

    // Up next additionally lists the bridge-pending term, slotted right before
    // the next normal row in tier order — discovery's order is untouched.
    const { rows: upNext } = await userLookupsRepository.listChunksForLanguage({
      userId,
      targetLanguage: 'ru',
      sort: 'recent',
      cursor: null,
      limit: 50,
      q: null,
      status: 'up_next',
      bookRemaining: 2,
    })
    expect(upNext.map((row) => row.id)).toEqual([b1, n1, b2, b3, bridgePending, n2, rareAhead, productionMarked, n3])
    expect(upNext.filter((row) => row.pinnedBookPriority).map((row) => row.id)).toEqual([b1, b2])

    // Paging through the same order with a 3-row page resumes exactly.
    const paged: string[] = []
    let cursor: ChunksCursor | null = null
    do {
      const page = await userLookupsRepository.listChunksForLanguage({
        userId,
        targetLanguage: 'ru',
        sort: 'recent',
        cursor,
        limit: 3,
        q: null,
        status: 'up_next',
        bookRemaining: 2,
      })
      paged.push(...page.rows.map((row) => row.id))
      cursor = page.nextCursor
    } while (cursor)
    expect(paged).toEqual(upNext.map((row) => row.id))

    // Reading mode's recognition new bucket serves the same order.
    const served = await userLookupsRepository.listReviewTerms({
      userId,
      targetLanguage: 'ru',
      pool: 'recognition',
      scope: 'learn_new',
      maxReviewTerms: 0,
      maxLearningTerms: 0,
      maxNewTerms: 50,
      maxOptInNewTerms: 0,
      bookRemaining: 2,
    })
    expect(served.map((row) => row.id)).toEqual(discovery)

    // No quota left today: plain tier order.
    const exhausted = await userLookupsRepository.listEligibleNewCitationFacets({
      userId,
      targetLanguage: 'ru',
      pool: 'recognition',
      bookRemaining: 0,
    })
    expect(exhausted).toEqual([n1, b3, n2, rareAhead, productionMarked, n3, b1, b2])
  })

  test('occurrences ahead follow the FURTHEST part read, pro-rating the current part', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const behind = await makeTerm(userId, 'позади', 5)
    const current = await makeTerm(userId, 'сейчас', 5)
    const ahead = await makeTerm(userId, 'впереди', 5)
    const { sourceId, trackIds } = await makeBook(userId, [{ позади: 10 }, { сейчас: 10 }, { впереди: 3 }])
    await bookPinsRepository.upsertPin({ userId, targetLanguage: 'ru', contentSourceId: sourceId })

    const aheadOf = async () => new Map((await introOrder(userId, 50)).map((row) => [row.id, row.book_ahead]))

    // Before any reading the whole book is ahead.
    expect((await aheadOf()).get(behind)).toBe(10)

    // Half of part 1 read: part 0 is behind, part 1 counts for half.
    await readTo(userId, sourceId, trackIds[1], 4)
    let byId = await aheadOf()
    expect(byId.get(behind)).toBe(0)
    expect(byId.get(current)).toBe(5)
    expect(byId.get(ahead)).toBe(3)

    // Rereading part 0 afterwards doesn't move the anchor back.
    await readTo(userId, sourceId, trackIds[0], 2)
    byId = await aheadOf()
    expect(byId.get(behind)).toBe(0)
    expect(byId.get(current)).toBe(5)
  })

  test('introductions are stamped with the book while in its stream, and the quota survives a pin change', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const member = await makeTerm(userId, 'метлица', 5)
    const other = await makeTerm(userId, 'другое', 5)
    const { sourceId } = await makeBook(userId, [{ метлица: 12 }])
    await bookPinsRepository.upsertPin({ userId, targetLanguage: 'ru', contentSourceId: sourceId })

    const facets = StudyFacetsRepository()
    const params = { userId, targetLanguage: 'ru', skill: 'meaning_recognition' as const, maxNewTerms: 20 }
    expect(await facets.initializeAndParkCitationFacetIfUnderDailyCap({ ...params, userLookupId: member })).toBe(
      'scaffolded'
    )
    expect(await facets.initializeCitationFacetIfUnderDailyCap({ ...params, userLookupId: other })).toBe(true)

    const stamps = (await sql`
      SELECT user_lookup_id, book_quota_source_id FROM public.study_facets
      WHERE user_lookup_id = ANY(${[member, other]}::uuid[]) AND skill = 'meaning_recognition'
    `) as Array<{ user_lookup_id: string; book_quota_source_id: string | null }>
    const stampOf = new Map(stamps.map((row) => [row.user_lookup_id, row.book_quota_source_id]))
    expect(stampOf.get(member)).toBe(sourceId)
    expect(stampOf.get(other)).toBeNull()

    const deps = { bookPinsRepository, userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepository() }
    expect(await resolveBookQuota(userId, 'ru', deps)).toMatchObject({ quota: 10, introducedToday: 1, remaining: 9 })

    // Pinning another book mid-day doesn't refill the quota.
    const { sourceId: nextBook } = await makeBook(userId, [{ другое: 50 }])
    await bookPinsRepository.upsertPin({ userId, targetLanguage: 'ru', contentSourceId: nextBook })
    expect(await resolveBookQuota(userId, 'ru', deps)).toMatchObject({
      contentSourceId: nextBook,
      introducedToday: 1,
      remaining: 9,
    })
  })
})
