import { describe, expect, test } from 'vitest'
import { __createUserInSupabaseAndGetHisIdAndToken, __generateUniqueId } from '../../../test/test-utils'
import { ContentSourcesRepository } from '../content-sources/content-sources-repository'
import { sql } from '../postgres-client'
import { TextTracksRepository } from './text-tracks-repository'

// Moderation columns: verdict written atomically with the track insert,
// NULL-repair-only backfill, and the pair CHECK (wrapped in IS TRUE — the
// bare OR evaluates to UNKNOWN for a (NULL, category) pair, which CHECK
// would accept).
describe('text-tracks-repository moderation integration tests', () => {
  const contentSourcesRepository = ContentSourcesRepository()
  const repository = TextTracksRepository()

  const createSourceFixture = async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    return contentSourcesRepository.insertContentSource({
      type: 'text',
      title: __generateUniqueId('moderation-track'),
      language: 'de',
      metadata: {},
      createdByUserId: userId,
    })
  }

  test('insertTextTrack persists the verdict pair; null means unchecked', async () => {
    const source = await createSourceFixture()
    const flagged = await repository.insertTextTrack({
      contentSourceId: source.id,
      source: 'paste',
      language: 'de',
      externalId: null,
      hash: __generateUniqueId('flagged'),
      moderation: { status: 'flagged', category: 'violence' },
    })
    expect(flagged.moderation_status).toBe('flagged')
    expect(flagged.moderation_category).toBe('violence')

    const unchecked = await repository.insertTextTrack({
      contentSourceId: source.id,
      source: 'paste',
      language: 'de',
      externalId: null,
      hash: __generateUniqueId('unchecked'),
      moderation: null,
    })
    expect(unchecked.moderation_status).toBeNull()
    expect(unchecked.moderation_category).toBeNull()
  })

  test('backfillModeration fills a NULL verdict and never overwrites an existing one', async () => {
    const source = await createSourceFixture()
    const track = await repository.insertTextTrack({
      contentSourceId: source.id,
      source: 'paste',
      language: 'de',
      externalId: null,
      hash: __generateUniqueId('backfill'),
      moderation: null,
    })

    await repository.backfillModeration(track.id, { status: 'flagged', category: 'hate' })
    const afterRepair = await repository.findById(track.id)
    expect(afterRepair?.moderation_status).toBe('flagged')
    expect(afterRepair?.moderation_category).toBe('hate')

    // A later 'clean' must not downgrade the flag — first verdict wins.
    await repository.backfillModeration(track.id, { status: 'clean', category: null })
    const afterSecond = await repository.findById(track.id)
    expect(afterSecond?.moderation_status).toBe('flagged')
    expect(afterSecond?.moderation_category).toBe('hate')
  })

  test('the pair CHECK rejects (clean, category) and (NULL, category)', async () => {
    const source = await createSourceFixture()

    await expect(
      repository.insertTextTrack({
        contentSourceId: source.id,
        source: 'paste',
        language: 'de',
        externalId: null,
        hash: __generateUniqueId('invalid-clean'),
        moderation: { status: 'clean', category: 'violence' },
      })
    ).rejects.toThrow(/moderation_pair_check/)

    // (NULL, category) can't be produced through the typed API — raw SQL
    // proves the IS TRUE wrapping catches the UNKNOWN case.
    await expect(
      sql`
        INSERT INTO public.text_tracks (content_source_id, source, language, external_id, hash, moderation_status, moderation_category)
        VALUES (${source.id}, 'paste', 'de', NULL, ${__generateUniqueId('invalid-null')}, NULL, 'violence')
      `
    ).rejects.toThrow(/moderation_pair_check/)
  })
})
