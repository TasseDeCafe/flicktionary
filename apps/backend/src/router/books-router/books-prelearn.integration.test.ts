import { describe, expect, test, vi } from 'vitest'
import request from 'supertest'
import { __generateUniqueId, buildAuthorizationHeaders, buildTestApp } from '../../test/test-utils'
import { sql } from '../../transport/database/postgres-client'
import { MockAnthropicPasses } from '../../transport/third-party/anthropic/anthropic-passes'
import { buildTrackLemmaProfile } from '../../service/lemma-profiles/build-track-lemma-profile'
import { TextTracksRepository } from '../../transport/database/text-tracks/text-tracks-repository'
import { TextSegmentsRepository } from '../../transport/database/text-segments/text-segments-repository'
import { WiktionaryMatchRepository } from '../../transport/database/wiktionary-entries/wiktionary-match-repository'
import { TextTrackLemmaProfilesRepository } from '../../transport/database/text-track-lemma-profiles/text-track-lemma-profiles-repository'
import { LemmaRanksRepository } from '../../transport/database/lemma-ranks/lemma-ranks-repository'
import { UserLookupsRepository } from '../../transport/database/user-lookups/user-lookups-repository'
import {
  adhocChunk,
  appendSegment,
  ensureRuLemmaRankManifest,
  insertWiktionaryLemma,
  setupCheckpointUser,
  uniqueCyrillicSuffix,
} from '../study-sessions-router/checkpoint-test-helpers'

// "Learn before you read" over real HTTP (docs/READER-SPEC.md, book page):
// the candidate list's filters, ordering, horizon and evidence; the Known
// write + un-mark; the per-occurrence gloss cache; and Learn's adhoc save.
// Book parts get real segments and real profile builds, so counts, the
// homograph rule and the evidence scan all run for real.
describe('books-router prelearn', () => {
  const basicDataPass = vi.fn()
  const prelearnGlossPass = vi.fn()
  const testApp = buildTestApp({
    anthropicPasses: MockAnthropicPasses({
      basicDataPass: basicDataPass as never,
      prelearnGlossPass: prelearnGlossPass as never,
    }),
  })
  const profileDeps = {
    textTracksRepository: TextTracksRepository(),
    textSegmentsRepository: TextSegmentsRepository(),
    wiktionaryMatchRepository: WiktionaryMatchRepository(),
    textTrackLemmaProfilesRepository: TextTrackLemmaProfilesRepository(),
    lemmaRanksRepository: LemmaRanksRepository(),
  }

  const rank = async (lemma: string, value: number) => {
    await sql`
      INSERT INTO public.lemma_ranks (target_language, lemma, rank, freq_mass)
      VALUES ('ru', ${lemma}, ${value}, ${1 / value})
    `
  }

  // A ready book whose parts are built from real segment text.
  const makeBook = async (userId: string, parts: string[][]) => {
    const [source] = (await sql`
      INSERT INTO public.content_sources (type, title, language, metadata, created_by_user_id)
      VALUES ('book', 'book', 'ru',
        ${sql.json({ importStatus: 'ready', contentHash: __generateUniqueId('hash') })}, ${userId})
      RETURNING id
    `) as [{ id: string }]
    const trackIds: string[] = []
    for (const [index, segments] of parts.entries()) {
      const [track] = (await sql`
        INSERT INTO public.text_tracks (content_source_id, source, language, external_id, hash, book_part_index,
          book_part_title)
        VALUES (${source.id}, 'upload', 'ru', NULL, ${__generateUniqueId('part')}, ${index}, ${`Part ${index}`})
        RETURNING id
      `) as [{ id: string }]
      for (const text of segments) await appendSegment(track.id, text)
      await buildTrackLemmaProfile(track.id, profileDeps)
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

  // Word fixtures (unique per test). Reading position: part 0, segment 1 of 4
  // read, so part 0 counts half.
  //   rare   rank 20000 — 1 (part 0, pro-rated) + 3 → listed first (book-specific)
  //   yolk   rank 9000, spelled with ё — 3 in part 1
  //   common rank 50 — 2 + 7 → listed last despite the most occurrences
  //   late   rank 8000 — 3 in part 2 only → only in the rest-of-book horizon
  //   known / saved / unranked / name / few / behind — never listed
  const setupBook = async () => {
    await ensureRuLemmaRankManifest()
    const { userId, token } = await setupCheckpointUser(testApp)
    const s = uniqueCyrillicSuffix()
    const w = {
      rare: `ред${s}`,
      yolk: `ёлк${s}`,
      yolkFolded: `елк${s}`,
      common: `общ${s}`,
      late: `позд${s}`,
      known: `знак${s}`,
      saved: `сохр${s}`,
      unranked: `безр${s}`,
      name: `имя${s}`,
      few: `мало${s}`,
      behind: `наз${s}`,
    }
    for (const word of [w.rare, w.yolk, w.common, w.late, w.known, w.saved, w.unranked, w.few, w.behind]) {
      await insertWiktionaryLemma(word, [])
    }
    await sql`
      INSERT INTO public.wiktionary_entries (target_language, headword, pos, data)
      VALUES ('ru', ${w.name}, 'name', ${sql.json({ head_templates: [{ name: 'head' }], senses: [{ glosses: ['x'] }] })})
    `
    await rank(w.rare, 20000)
    await rank(w.yolkFolded, 9000)
    await rank(w.common, 50)
    await rank(w.late, 8000)
    await rank(w.known, 1000)
    await rank(w.saved, 1000)
    await rank(w.name, 3000)
    await rank(w.few, 5000)
    await rank(w.behind, 4000)

    const { sourceId, trackIds } = await makeBook(userId, [
      [
        `${w.behind} ${w.behind} ${w.behind} ${w.behind} ${w.behind} ${w.behind} ${w.common}`,
        `${w.common}`,
        `Он сказал: ${w.rare} и ${w.common}, ${w.saved} ${w.known} ${w.unranked} ${w.name} ${w.few}.`,
        `${w.rare} ${w.common} ${w.saved} ${w.known} ${w.unranked} ${w.name}`,
      ],
      [
        `${w.rare} ${w.common} ${w.common} ${w.common} ${w.saved} ${w.known} ${w.unranked} ${w.name} ${w.few}`,
        `${w.common} ${w.common} ${w.common} ${w.common} ${w.rare} ${w.rare} ${w.saved} ${w.saved}`,
        `${w.known} ${w.known} ${w.known} ${w.name} ${w.name} ${w.unranked} ${w.unranked} ${w.yolk} ${w.yolk} ${w.yolk}`,
      ],
      [`${w.late} ${w.late} ${w.late} ${w.common}`],
    ])
    await readTo(userId, sourceId, trackIds[0]!, 1)

    await sql`
      INSERT INTO public.known_lemmas (user_id, target_language, lemma, source)
      VALUES (${userId}, 'ru', ${w.known}, 'bulk_text')
    `
    const lookup = await UserLookupsRepository().findOrCreate({
      userId,
      targetLanguage: 'ru',
      headword: w.saved,
      sense: 'x',
    })
    await sql`UPDATE public.user_lookups SET count = 1 WHERE id = ${lookup.id}`

    return { userId, token, sourceId, w }
  }

  const getList = (token: string, sourceId: string, horizon: 'next_part' | 'rest_of_book') =>
    request(testApp).get(`/api/v1/books/${sourceId}/prelearn`).query({ horizon }).set(buildAuthorizationHeaders(token))

  test('returns 401 when unauthenticated', async () => {
    const response = await request(testApp)
      .get('/api/v1/books/00000000-0000-0000-0000-000000000001/prelearn')
      .query({ horizon: 'next_part' })
      .set({ Authorization: 'Bearer wrong-token' })
    expect(response.status).toBe(401)
  })

  test('lists book-specific words first, with filters, horizon, display spelling and the next occurrence', async () => {
    const { token, sourceId, w } = await setupBook()

    const next = await getList(token, sourceId, 'next_part')
    expect(next.status).toBe(200)
    expect(next.body.data.savedCount).toBe(1)
    expect(next.body.data.items.map((item: { lemma: string }) => item.lemma)).toEqual([w.rare, w.yolkFolded, w.common])
    const [rare, yolk, common] = next.body.data.items
    expect(rare).toMatchObject({ headword: w.rare, aheadCount: 4, surface: w.rare })
    // The first occurrence AFTER the reading position (segment 2 of part 0).
    expect(rare.context).toContain(`Он сказал: ${w.rare}`)
    // The fold lost the ё; the dictionary spelling brings it back.
    expect(yolk).toMatchObject({ headword: w.yolk, aheadCount: 3 })
    expect(common.aheadCount).toBe(9)

    const rest = await getList(token, sourceId, 'rest_of_book')
    expect(rest.body.data.items.map((item: { lemma: string }) => item.lemma)).toEqual([
      w.rare,
      w.yolkFolded,
      w.late,
      w.common,
    ])
    expect(rest.body.data.hasMore).toBe(false)
  })

  test('limit cuts the list and hasMore says whether more words qualify', async () => {
    const { token, sourceId, w } = await setupBook()

    const firstPage = await request(testApp)
      .get(`/api/v1/books/${sourceId}/prelearn`)
      .query({ horizon: 'rest_of_book', limit: 2 })
      .set(buildAuthorizationHeaders(token))
    expect(firstPage.status).toBe(200)
    expect(firstPage.body.data.items.map((item: { lemma: string }) => item.lemma)).toEqual([w.rare, w.yolkFolded])
    expect(firstPage.body.data.hasMore).toBe(true)

    const exact = await request(testApp)
      .get(`/api/v1/books/${sourceId}/prelearn`)
      .query({ horizon: 'rest_of_book', limit: 4 })
      .set(buildAuthorizationHeaders(token))
    expect(exact.body.data.items).toHaveLength(4)
    expect(exact.body.data.hasMore).toBe(false)
  })

  test("another user's book is NOT_FOUND", async () => {
    const { sourceId } = await setupBook()
    const other = await setupCheckpointUser(testApp)
    const response = await getList(other.token, sourceId, 'next_part')
    expect(response.status).toBe(404)
  })

  test('Known removes the word; the gloss sheet un-mark brings it back; a word not in the book is NOT_FOUND', async () => {
    const { token, sourceId, w } = await setupBook()

    const marked = await request(testApp)
      .post(`/api/v1/books/${sourceId}/prelearn/known`)
      .set(buildAuthorizationHeaders(token))
      .send({ lemma: w.rare })
    expect(marked.status).toBe(200)
    expect(marked.body.data.markedCount).toBe(1)
    const [row] = (await sql`
      SELECT source, source_id FROM public.known_lemmas WHERE lemma = ${w.rare}
    `) as [{ source: string; source_id: string }]
    expect(row).toEqual({ source: 'book_prelearn', source_id: sourceId })

    const afterMark = await getList(token, sourceId, 'next_part')
    expect(afterMark.body.data.items.map((item: { lemma: string }) => item.lemma)).not.toContain(w.rare)

    const unmarked = await request(testApp)
      .post('/api/v1/known-lemmas/unmark')
      .set(buildAuthorizationHeaders(token))
      .send({ targetLanguage: 'ru', lemmas: [w.rare] })
    expect(unmarked.status).toBe(200)
    const afterUndo = await getList(token, sourceId, 'next_part')
    expect(afterUndo.body.data.items[0].lemma).toBe(w.rare)

    const foreign = await request(testApp)
      .post(`/api/v1/books/${sourceId}/prelearn/known`)
      .set(buildAuthorizationHeaders(token))
      .send({ lemma: `чужое${uniqueCyrillicSuffix()}` })
    expect(foreign.status).toBe(404)
  })

  test('glosses are generated once per occurrence and cached; foreign words are ignored', async () => {
    const { token, sourceId, w } = await setupBook()
    const list = await getList(token, sourceId, 'next_part')
    const [rare, yolk] = list.body.data.items
    const items = [rare, yolk].map((item) => ({
      lemma: item.lemma,
      headword: item.headword,
      segmentId: item.segmentId,
      context: item.context,
    }))
    const foreign = { ...items[0], lemma: `чужое${uniqueCyrillicSuffix()}` }

    prelearnGlossPass.mockClear()
    prelearnGlossPass.mockResolvedValueOnce(['rare gloss', 'yolk gloss'])
    const first = await request(testApp)
      .post(`/api/v1/books/${sourceId}/prelearn/glosses`)
      .set(buildAuthorizationHeaders(token))
      .send({ items: [...items, foreign] })
    expect(first.status).toBe(200)
    expect(first.body.data.glosses).toEqual([
      { lemma: w.rare, gloss: 'rare gloss' },
      { lemma: w.yolkFolded, gloss: 'yolk gloss' },
    ])
    expect(prelearnGlossPass).toHaveBeenCalledTimes(1)
    expect(prelearnGlossPass.mock.calls[0]![0].items).toEqual([
      { headword: rare.headword, context: rare.context },
      { headword: yolk.headword, context: yolk.context },
    ])

    const second = await request(testApp)
      .post(`/api/v1/books/${sourceId}/prelearn/glosses`)
      .set(buildAuthorizationHeaders(token))
      .send({ items })
    expect(second.body.data.glosses).toEqual(first.body.data.glosses)
    expect(prelearnGlossPass).toHaveBeenCalledTimes(1)
  })

  test('Learn saves a recognition-only card from the next occurrence; the word leaves the list', async () => {
    const { token, sourceId, w } = await setupBook()
    const list = await getList(token, sourceId, 'next_part')
    const rare = list.body.data.items[0]

    basicDataPass.mockResolvedValueOnce([adhocChunk(rare.headword, 'sense')])
    const learned = await request(testApp)
      .post(`/api/v1/books/${sourceId}/prelearn/learn`)
      .set(buildAuthorizationHeaders(token))
      .send({ lemma: rare.lemma, headword: rare.headword, context: rare.context })
    expect(learned.status).toBe(200)

    // The pass saw the book sentence as the card's context.
    const passSegments = basicDataPass.mock.calls.at(-1)![0].segments
    expect(passSegments[0].text).toContain(rare.context)

    const facets = (await sql`
      SELECT f.skill FROM public.study_facets f
      JOIN public.cards c ON c.user_lookup_id = f.user_lookup_id
      WHERE c.id = ${learned.body.data.cardId} AND f.disabled_at IS NULL
    `) as Array<{ skill: string }>
    expect(facets.map((f) => f.skill)).toEqual(['meaning_recognition'])

    const after = await getList(token, sourceId, 'next_part')
    expect(after.body.data.items.map((item: { lemma: string }) => item.lemma)).not.toContain(w.rare)
    expect(after.body.data.savedCount).toBe(2)
  })
})
