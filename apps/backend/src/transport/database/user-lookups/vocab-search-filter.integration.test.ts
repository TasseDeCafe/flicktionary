import { describe, expect, test } from 'vitest'
import { UserLookupsRepository, type ChunkRow } from './user-lookups-repository'
import { sql } from '../postgres-client'
import { __createUserInSupabaseAndGetHisIdAndToken } from '../../../test/test-utils'

// The vocabulary q filter against a real DB: unaccent-insensitive substring
// across headword/translation/definition, pg_trgm word_similarity typo
// tolerance (threshold pinned here — see SEARCH_WORD_SIMILARITY_THRESHOLD),
// and LIKE metacharacters matched literally.
describe('listChunksForLanguage: q search filter', () => {
  const userLookupsRepository = UserLookupsRepository()

  const makeTerm = async (params: {
    userId: string
    headword: string
    translation?: string | null
    definition?: string | null
  }) => {
    const lookup = await userLookupsRepository.findOrCreate({
      userId: params.userId,
      targetLanguage: 'es',
      headword: params.headword,
      sense: 'x',
    })
    await sql`
      UPDATE public.user_lookups
      SET count = 1,
          translation = ${params.translation ?? null},
          definition = ${params.definition ?? null}
      WHERE id = ${lookup.id}
    `
    return lookup
  }

  const search = async (userId: string, q: string): Promise<ChunkRow[]> => {
    const { rows } = await userLookupsRepository.listChunksForLanguage({
      userId,
      targetLanguage: 'es',
      sort: 'recent',
      cursor: null,
      limit: 50,
      q,
      status: null,
    })
    return rows
  }

  const expectHits = (rows: ChunkRow[], expectedIds: string[]) => {
    expect(new Set(rows.map((r) => r.id))).toEqual(new Set(expectedIds))
  }

  test('substring matching is accent- and case-insensitive in both directions', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const arbol = await makeTerm({ userId, headword: 'árbol' })
    await makeTerm({ userId, headword: 'sendero' })

    expectHits(await search(userId, 'arbol'), [arbol.id])
    expectHits(await search(userId, 'ÁRBOL'), [arbol.id])
  })

  test('a one-letter typo still finds the term (word_similarity over the 0.45 threshold)', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const vixen = await makeTerm({ userId, headword: 'vixen' })
    await makeTerm({ userId, headword: 'badger' })

    // word_similarity('vixin','vixen') = 0.5 — the reason the threshold sits
    // below pg_trgm's 0.6 default.
    expectHits(await search(userId, 'vixin'), [vixen.id])
  })

  test('hyphenated terms match their unhyphenated spelling via trigram similarity', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const hyphenated = await makeTerm({ userId, headword: 'panty-waist' })

    expectHits(await search(userId, 'pantywaist'), [hyphenated.id])
  })

  test('matches translation and definition, not just the headword', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const byTranslation = await makeTerm({ userId, headword: 'zorro', translation: 'a cunning fox' })
    const byDefinition = await makeTerm({ userId, headword: 'tejón', definition: 'burrowing nocturnal mammal' })

    expectHits(await search(userId, 'cunning'), [byTranslation.id])
    expectHits(await search(userId, 'burrowing'), [byDefinition.id])
  })

  test('LIKE metacharacters are literal: % no longer matches everything', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    await makeTerm({ userId, headword: 'ordinario' })
    const percent = await makeTerm({ userId, headword: 'descuento', translation: 'save 100% today' })

    expectHits(await search(userId, '100%'), [percent.id])
    expectHits(await search(userId, '%%%%'), [])
  })

  test('a query unrelated to any field matches nothing', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    await makeTerm({ userId, headword: 'montaña' })

    expectHits(await search(userId, 'qqqqqqqq'), [])
  })
})
