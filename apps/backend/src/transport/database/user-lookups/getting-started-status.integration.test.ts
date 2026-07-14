import { describe, expect, test } from 'vitest'
import { __createUserInSupabaseAndGetHisIdAndToken } from '../../../test/test-utils'
import { sql } from '../postgres-client'
import { UserLookupsRepository } from './user-lookups-repository'

describe('user-lookups getting-started predicate', () => {
  test('counts only kept, non-deleted lookups', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const repository = UserLookupsRepository()
    const lookup = await repository.findOrCreate({
      userId,
      targetLanguage: 'es',
      headword: 'gato',
      sense: 'animal',
    })

    expect(await repository.hasKeptLookup(userId)).toBe(false)

    await sql`UPDATE public.user_lookups SET count = 1 WHERE id = ${lookup.id}`
    expect(await repository.hasKeptLookup(userId)).toBe(true)

    await repository.softDeleteChunk(lookup.id, userId)
    expect(await repository.hasKeptLookup(userId)).toBe(false)
  })
})
