import { describe, expect, test } from 'vitest'
import { __createUserInSupabaseAndGetHisIdAndToken, __generateUniqueId } from '../../../test/test-utils'
import { ContentSourcesRepository } from '../content-sources/content-sources-repository'
import { TextTracksRepository } from '../text-tracks/text-tracks-repository'
import { sql } from '../postgres-client'
import { TextTrackLemmaProfilesRepository, type ProfileRowInput } from './text-track-lemma-profiles-repository'

describe('text-track-lemma-profiles-repository integration tests', () => {
  const contentSourcesRepository = ContentSourcesRepository()
  const textTracksRepository = TextTracksRepository()
  const repository = TextTrackLemmaProfilesRepository()

  const createTrackFixture = async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const unique = __generateUniqueId('profile-track')
    const source = await contentSourcesRepository.insertContentSource({
      type: 'text',
      title: unique,
      language: 'ru',
      metadata: {},
      createdByUserId: userId,
    })
    const track = await textTracksRepository.insertTextTrack({
      contentSourceId: source.id,
      source: 'paste',
      language: 'ru',
      externalId: null,
      hash: unique,
    })
    return { userId, track }
  }

  test('replaceProfile writes rows and stamps the track bookkeeping', async () => {
    const { track } = await createTrackFixture()
    const rows: ProfileRowInput[] = [
      { foldedToken: 'стол', tokenCount: 3, candidateLemmas: ['стол'] },
      { foldedToken: 'стали', tokenCount: 1, candidateLemmas: ['сталь', 'стать'] },
    ]

    await repository.replaceProfile({
      textTrackId: track.id,
      rows,
      segmentCount: 12,
      maxSegmentIndex: 11,
      wordTokenCount: 40,
      matchedTokenCount: 37,
    })

    const stored = await repository.listRowsByTrackId(track.id)
    expect(stored).toHaveLength(2)
    // Ordered by folded_token.
    expect(stored[0]).toMatchObject({ folded_token: 'стали', token_count: 1, candidate_lemmas: ['сталь', 'стать'] })
    expect(stored[1]).toMatchObject({ folded_token: 'стол', token_count: 3, candidate_lemmas: ['стол'] })

    const updatedTrack = await textTracksRepository.findById(track.id)
    expect(updatedTrack?.profile_built_at).not.toBeNull()
    expect(updatedTrack?.profile_segment_count).toBe(12)
    expect(updatedTrack?.profile_max_segment_index).toBe(11)
    expect(updatedTrack?.profile_word_token_count).toBe(40)
    expect(updatedTrack?.profile_matched_token_count).toBe(37)
  })

  test('replaceProfile is a whole-profile swap — stale rows never survive a rebuild', async () => {
    const { track } = await createTrackFixture()
    await repository.replaceProfile({
      textTrackId: track.id,
      rows: [{ foldedToken: 'старый', tokenCount: 2, candidateLemmas: ['старый'] }],
      segmentCount: 1,
      maxSegmentIndex: 0,
      wordTokenCount: 2,
      matchedTokenCount: 2,
    })
    await repository.replaceProfile({
      textTrackId: track.id,
      rows: [{ foldedToken: 'новый', tokenCount: 5, candidateLemmas: ['новый'] }],
      segmentCount: 2,
      maxSegmentIndex: 1,
      wordTokenCount: 5,
      matchedTokenCount: 5,
    })

    const stored = await repository.listRowsByTrackId(track.id)
    expect(stored).toHaveLength(1)
    expect(stored[0]?.folded_token).toBe('новый')
  })

  test('an empty profile build clears rows but still stamps bookkeeping', async () => {
    const { track } = await createTrackFixture()
    await repository.replaceProfile({
      textTrackId: track.id,
      rows: [{ foldedToken: 'слово', tokenCount: 1, candidateLemmas: ['слово'] }],
      segmentCount: 1,
      maxSegmentIndex: 0,
      wordTokenCount: 1,
      matchedTokenCount: 1,
    })
    await repository.replaceProfile({
      textTrackId: track.id,
      rows: [],
      segmentCount: 0,
      maxSegmentIndex: null,
      wordTokenCount: 0,
      matchedTokenCount: 0,
    })

    expect(await repository.listRowsByTrackId(track.id)).toHaveLength(0)
    const updatedTrack = await textTracksRepository.findById(track.id)
    expect(updatedTrack?.profile_built_at).not.toBeNull()
    expect(updatedTrack?.profile_max_segment_index).toBeNull()
  })

  test('two concurrent builders produce one coherent winner, never a mix', async () => {
    const { track } = await createTrackFixture()
    const buildA: ProfileRowInput[] = [
      { foldedToken: 'один', tokenCount: 1, candidateLemmas: ['один'] },
      { foldedToken: 'два', tokenCount: 2, candidateLemmas: ['два'] },
    ]
    const buildB: ProfileRowInput[] = [
      { foldedToken: 'три', tokenCount: 3, candidateLemmas: ['три'] },
      { foldedToken: 'четыре', tokenCount: 4, candidateLemmas: ['четыре'] },
    ]

    await Promise.all([
      repository.replaceProfile({
        textTrackId: track.id,
        rows: buildA,
        segmentCount: 1,
        maxSegmentIndex: 0,
        wordTokenCount: 3,
        matchedTokenCount: 3,
      }),
      repository.replaceProfile({
        textTrackId: track.id,
        rows: buildB,
        segmentCount: 2,
        maxSegmentIndex: 1,
        wordTokenCount: 7,
        matchedTokenCount: 7,
      }),
    ])

    const stored = await repository.listRowsByTrackId(track.id)
    const tokens = stored.map((r) => r.folded_token).sort()
    const isAllA = JSON.stringify(tokens) === JSON.stringify(['два', 'один'].sort())
    const isAllB = JSON.stringify(tokens) === JSON.stringify(['три', 'четыре'].sort())
    expect(isAllA || isAllB).toBe(true)
  })

  test('rejects invalid rows via the table CHECK constraints', async () => {
    const { track } = await createTrackFixture()
    await expect(
      repository.replaceProfile({
        textTrackId: track.id,
        rows: [{ foldedToken: 'пусто', tokenCount: 1, candidateLemmas: [] }],
        segmentCount: 1,
        maxSegmentIndex: 0,
        wordTokenCount: 1,
        matchedTokenCount: 1,
      })
    ).rejects.toThrow()
    await expect(
      repository.replaceProfile({
        textTrackId: track.id,
        rows: [{ foldedToken: 'ноль', tokenCount: 0, candidateLemmas: ['ноль'] }],
        segmentCount: 1,
        maxSegmentIndex: 0,
        wordTokenCount: 1,
        matchedTokenCount: 1,
      })
    ).rejects.toThrow()
  })

  test('profile rows cascade away with the track', async () => {
    const { track } = await createTrackFixture()
    await repository.replaceProfile({
      textTrackId: track.id,
      rows: [{ foldedToken: 'слово', tokenCount: 1, candidateLemmas: ['слово'] }],
      segmentCount: 1,
      maxSegmentIndex: 0,
      wordTokenCount: 1,
      matchedTokenCount: 1,
    })
    await sql`DELETE FROM public.text_tracks WHERE id = ${track.id}`
    expect(await repository.listRowsByTrackId(track.id)).toHaveLength(0)
  })
})
