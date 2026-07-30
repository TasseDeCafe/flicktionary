import { describe, expect, test } from 'vitest'
import { __createUserInSupabaseAndGetHisIdAndToken, __generateUniqueId } from '../../../test/test-utils'
import { StudySessionsRepository } from './study-sessions-repository'

// The imported-text upsert's moderation merge: first verdict wins, a NULL
// verdict is repaired on re-import, and a later verdict never overwrites an
// existing one (no clean-downgrades-flagged, no failed-open nulling).
describe('getOrCreateForImportedText moderation merge integration tests', () => {
  const repository = StudySessionsRepository()

  const importParams = async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const unique = __generateUniqueId('imported-text-moderation')
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
    }
  }

  test('re-import repairs a NULL verdict but never overwrites a non-null one', async () => {
    const params = await importParams()

    // Pre-feature / failed-open shape: no verdict.
    const first = await repository.getOrCreateForImportedText({ ...params, moderation: null })
    expect(first.track.moderation_status).toBeNull()

    // Re-import with a verdict repairs the NULL (both columns together).
    const repaired = await repository.getOrCreateForImportedText({
      ...params,
      moderation: { status: 'flagged', category: 'violence' },
    })
    expect(repaired.track.id).toBe(first.track.id)
    expect(repaired.track.moderation_status).toBe('flagged')
    expect(repaired.track.moderation_category).toBe('violence')

    // A later clean verdict must not downgrade the flag.
    const third = await repository.getOrCreateForImportedText({
      ...params,
      moderation: { status: 'clean', category: null },
    })
    expect(third.track.moderation_status).toBe('flagged')
    expect(third.track.moderation_category).toBe('violence')

    // And a later failed-open (null) re-import must not null it out.
    const fourth = await repository.getOrCreateForImportedText({ ...params, moderation: null })
    expect(fourth.track.moderation_status).toBe('flagged')
  })
})
