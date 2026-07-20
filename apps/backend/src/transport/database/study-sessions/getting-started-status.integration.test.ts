import { describe, expect, test } from 'vitest'
import { __createUserInSupabaseAndGetHisIdAndToken, __generateUniqueId } from '../../../test/test-utils'
import { ContentSourcesRepository, type ContentSourceType } from '../content-sources/content-sources-repository'
import { TextTracksRepository } from '../text-tracks/text-tracks-repository'
import { StudySessionsRepository } from './study-sessions-repository'

describe('study-sessions getting-started predicate', () => {
  test('counts only visible, non-adhoc sessions', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const contentSourcesRepository = ContentSourcesRepository()
    const textTracksRepository = TextTracksRepository()
    const studySessionsRepository = StudySessionsRepository()

    const createSession = async (type: ContentSourceType) => {
      const unique = __generateUniqueId(type)
      const source = await contentSourcesRepository.insertContentSource({
        type,
        title: unique,
        language: 'es',
        metadata: {},
        createdByUserId: userId,
      })
      const track = await textTracksRepository.insertTextTrack({
        contentSourceId: source.id,
        source: 'paste',
        language: 'es',
        externalId: null,
        hash: unique,
      })
      const inserted = await studySessionsRepository.insertStudySession({
        userId,
        contentSourceId: source.id,
        textTrackId: track.id,
        nativeLanguage: 'en',
        targetLanguage: 'es',
        cefrLevel: 'B1',
      })
      expect(inserted).not.toBeNull()
      return inserted!.session
    }

    expect(await studySessionsRepository.hasVisibleSession(userId)).toBe(false)
    await createSession('adhoc')
    expect(await studySessionsRepository.hasVisibleSession(userId)).toBe(false)

    const visible = await createSession('text')
    expect(await studySessionsRepository.hasVisibleSession(userId)).toBe(true)

    await studySessionsRepository.softDelete(visible.id, userId)
    expect(await studySessionsRepository.hasVisibleSession(userId)).toBe(false)
  })
})
