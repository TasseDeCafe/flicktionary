import { randomUUID } from 'crypto'
import { describe, expect, test } from 'vitest'
import { KnownLemmasRepository } from './known-lemmas-repository'
import { sql } from '../postgres-client'
import { __createUserInSupabaseAndGetHisIdAndToken, __generateUniqueId } from '../../../test/test-utils'

const repo = KnownLemmasRepository()

const listRows = async (userId: string): Promise<Array<{ lemma: string; sweep_batch_id: string | null }>> =>
  (await sql`
    SELECT lemma, sweep_batch_id FROM public.known_lemmas
    WHERE user_id = ${userId} ORDER BY lemma
  `) as Array<{ lemma: string; sweep_batch_id: string | null }>

describe('known-lemmas sweep provenance', () => {
  test('delete-by-batch removes exactly one sweep; delete-by-source clears the session', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const sessionA = randomUUID()
    const sessionB = randomUUID()
    const batch1 = randomUUID()
    const batch2 = randomUUID()
    const first = __generateUniqueId('перв')
    const second = __generateUniqueId('втор')
    const otherSession = __generateUniqueId('друг')
    const manual = __generateUniqueId('ручн')

    // Two accumulating sweeps of session A, one sweep of session B, and a
    // non-sweep row with no source_id.
    // postgres.js quirk: sql.array() on the client's very FIRST query
    // serializes before the lazy array-type-OID fetch completes and produces
    // a malformed literal. Real code paths always run other queries first;
    // this test's user is created over HTTP, so warm the client explicitly.
    await sql`SELECT 1`

    await repo.bulkMarkKnown({
      userId,
      targetLanguage: 'ru',
      lemmas: [first],
      source: 'bulk_text',
      sourceId: sessionA,
      sweepBatchId: batch1,
    })
    // Overlap with sweep 1 is free — the batch must not steal sweep 1's row.
    await repo.bulkMarkKnown({
      userId,
      targetLanguage: 'ru',
      lemmas: [first, second],
      source: 'bulk_text',
      sourceId: sessionA,
      sweepBatchId: batch2,
    })
    await repo.bulkMarkKnown({
      userId,
      targetLanguage: 'ru',
      lemmas: [otherSession],
      source: 'bulk_text',
      sourceId: sessionB,
      sweepBatchId: randomUUID(),
    })
    await repo.bulkMarkKnown({
      userId,
      targetLanguage: 'ru',
      lemmas: [manual],
      source: 'bulk_text',
      sourceId: null,
      sweepBatchId: null,
    })

    expect(await repo.countBySource({ userId, source: 'bulk_text', sourceId: sessionA })).toBe(2)

    // Sweep-exact undo of the second press: only its genuinely-new row goes.
    const undone = await repo.deleteBySource({
      userId,
      source: 'bulk_text',
      sourceId: sessionA,
      sweepBatchId: batch2,
    })
    expect(undone).toBe(1)
    expect((await listRows(userId)).map((r) => r.lemma)).toEqual([otherSession, first, manual].sort())

    // Session-wide clear takes the remaining session-A row and nothing else.
    const cleared = await repo.deleteBySource({ userId, source: 'bulk_text', sourceId: sessionA })
    expect(cleared).toBe(1)
    expect((await listRows(userId)).map((r) => r.lemma)).toEqual([otherSession, manual].sort())
    expect(await repo.countBySource({ userId, source: 'bulk_text', sourceId: sessionA })).toBe(0)
    expect(await repo.countBySource({ userId, source: 'bulk_text', sourceId: sessionB })).toBe(1)
  })
})
