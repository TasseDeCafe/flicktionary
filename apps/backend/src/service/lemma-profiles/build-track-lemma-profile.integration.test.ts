import { describe, expect, test } from 'vitest'
import { __createUserInSupabaseAndGetHisIdAndToken, __generateUniqueId } from '../../test/test-utils'
import { ContentSourcesRepository } from '../../transport/database/content-sources/content-sources-repository'
import { TextTracksRepository } from '../../transport/database/text-tracks/text-tracks-repository'
import { TextSegmentsRepository } from '../../transport/database/text-segments/text-segments-repository'
import { TextTrackLemmaProfilesRepository } from '../../transport/database/text-track-lemma-profiles/text-track-lemma-profiles-repository'
import { WiktionaryMatchRepository } from '../../transport/database/wiktionary-entries/wiktionary-match-repository'
import { LemmaRanksRepository } from '../../transport/database/lemma-ranks/lemma-ranks-repository'
import { sql } from '../../transport/database/postgres-client'
import {
  appendSegment,
  insertWiktionaryLemma,
  uniqueCyrillicSuffix,
} from '../../router/study-sessions-router/checkpoint-test-helpers'
import { buildTrackLemmaProfile, TRACK_LEMMA_PROFILE_VERSION } from './build-track-lemma-profile'

// The real builder over real repositories: book parts get guarded per-lemma
// counts alongside the profile; other sources get none. Words are unique
// nonsense Russian lemmas so the shared wiktionary tables isolate each test.
describe('buildTrackLemmaProfile', () => {
  const deps = {
    textTracksRepository: TextTracksRepository(),
    textSegmentsRepository: TextSegmentsRepository(),
    wiktionaryMatchRepository: WiktionaryMatchRepository(),
    textTrackLemmaProfilesRepository: TextTrackLemmaProfilesRepository(),
    lemmaRanksRepository: LemmaRanksRepository(),
  }

  const createTrack = async (type: 'book' | 'text') => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const unique = __generateUniqueId('build-profile')
    const source = await ContentSourcesRepository().insertContentSource({
      type,
      title: unique,
      language: 'ru',
      metadata: {},
      createdByUserId: userId,
    })
    return TextTracksRepository().insertTextTrack({
      contentSourceId: source.id,
      source: 'paste',
      language: 'ru',
      externalId: null,
      hash: unique,
      moderation: null,
    })
  }

  const bookCountsOf = async (textTrackId: string) =>
    (await sql`
      SELECT lemma, occurrences, primary_occurrences FROM public.book_part_lemma_counts
      WHERE text_track_id = ${textTrackId} ORDER BY lemma
    `) as Array<{ lemma: string; occurrences: number; primary_occurrences: number | null }>

  test('a book part gets per-lemma counts, digit-hyphen pieces excluded, and the current version', async () => {
    const suffix = uniqueCyrillicSuffix()
    const broom = `метла${suffix}`
    await insertWiktionaryLemma(broom, [`метлу${suffix}`, `метлой${suffix}`])
    const track = await createTrack('book')
    await appendSegment(track.id, `Он взял метлу${suffix}. Метла${suffix} стояла у двери.`)
    await appendSegment(track.id, `С метлой${suffix} в руке, и 27-метла${suffix} не в счёт.`)

    const result = await buildTrackLemmaProfile(track.id, deps)
    expect(result.status).toBe('built')

    const broomCount = (await bookCountsOf(track.id)).find((row) => row.lemma === broom)
    expect(broomCount?.occurrences).toBe(3)
    expect(broomCount?.primary_occurrences).toBe(3)
    expect((await TextTracksRepository().findById(track.id))?.profile_version).toBe(TRACK_LEMMA_PROFILE_VERSION)
  })

  test('a non-book track gets a profile but no book counts', async () => {
    const suffix = uniqueCyrillicSuffix()
    const word = `палочка${suffix}`
    await insertWiktionaryLemma(word, [])
    const track = await createTrack('text')
    await appendSegment(track.id, `${word} и ещё ${word}`)

    await buildTrackLemmaProfile(track.id, deps)

    expect(await bookCountsOf(track.id)).toEqual([])
    const profile = await TextTrackLemmaProfilesRepository().listRowsByTrackId(track.id)
    expect(profile.find((row) => row.folded_token === word)?.token_count).toBe(2)
  })
})
