import { describe, expect, test } from 'vitest'
import { __createUserInSupabaseAndGetHisIdAndToken, __generateUniqueId } from '../../../test/test-utils'
import { sql } from '../postgres-client'
import { ImportBatchesRepository } from './import-batches-repository'

// Moderation columns on lesson-import batches: verdict written with the
// insert, NULL-repair-only backfill (the resume-dedupe path re-checks NULL
// batches and repairs them), and the IS TRUE pair CHECK.
describe('import-batches-repository moderation integration tests', () => {
  const repository = ImportBatchesRepository()

  const insertBatchFixture = async (moderation: { status: 'clean' | 'flagged'; category: string | null } | null) => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const unique = __generateUniqueId('moderation-batch')
    const batch = await repository.insertBatch({
      userId,
      targetLanguage: 'de',
      teacherProfileId: null,
      sourceTitle: 'Lesson notes',
      rawText: unique,
      inputHash: unique,
      moderation,
    })
    expect(batch).not.toBeNull()
    return batch!
  }

  test('insertBatch persists the verdict pair; null means unchecked', async () => {
    const clean = await insertBatchFixture({ status: 'clean', category: null })
    expect(clean.moderation_status).toBe('clean')
    expect(clean.moderation_category).toBeNull()

    const unchecked = await insertBatchFixture(null)
    expect(unchecked.moderation_status).toBeNull()
    expect(unchecked.moderation_category).toBeNull()
  })

  test('backfillModeration fills a NULL verdict and never overwrites an existing one', async () => {
    const batch = await insertBatchFixture(null)

    await repository.backfillModeration(batch.id, { status: 'flagged', category: 'violence' })
    const afterRepair = await repository.findById(batch.id)
    expect(afterRepair?.moderation_status).toBe('flagged')
    expect(afterRepair?.moderation_category).toBe('violence')

    await repository.backfillModeration(batch.id, { status: 'clean', category: null })
    const afterSecond = await repository.findById(batch.id)
    expect(afterSecond?.moderation_status).toBe('flagged')
    expect(afterSecond?.moderation_category).toBe('violence')
  })

  test('the pair CHECK rejects invalid combinations', async () => {
    await expect(insertBatchFixture({ status: 'flagged', category: null })).rejects.toThrow(/moderation_pair_check/)

    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const unique = __generateUniqueId('invalid-null-pair')
    await expect(
      sql`
        INSERT INTO public.import_batches (user_id, target_language, teacher_profile_id, source_title, raw_text, input_hash, status, expires_at, moderation_status, moderation_category)
        VALUES (${userId}, 'de', NULL, 'Lesson notes', ${unique}, ${unique}, 'extracting', NOW() + make_interval(days => 30), NULL, 'violence')
      `
    ).rejects.toThrow(/moderation_pair_check/)
  })
})
