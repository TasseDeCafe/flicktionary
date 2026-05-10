import { createHash } from 'node:crypto'
import { ContentSourcesRepositoryInterface } from '../../transport/database/content-sources/content-sources-repository'
import { TextTracksRepositoryInterface, DbTextTrack } from '../../transport/database/text-tracks/text-tracks-repository'
import {
  StudySessionsRepositoryInterface,
  DbStudySession,
} from '../../transport/database/study-sessions/study-sessions-repository'
import { ADHOC_CONTEXT_BLOB, ADHOC_SOURCE_TITLE } from './constants'

export type GetOrCreateAdhocSessionDependencies = {
  contentSourcesRepository: ContentSourcesRepositoryInterface
  textTracksRepository: TextTracksRepositoryInterface
  studySessionsRepository: StudySessionsRepositoryInterface
}

// Deterministic per-(user, language) track hash so the (content_source_id,
// language, hash) unique constraint never blocks the second call. Not
// load-bearing for security — adhoc tracks aren't shared across users —
// just a stable string to satisfy the schema.
const adhocTrackHash = (userId: string, targetLanguage: string): string =>
  'adhoc:' + createHash('sha256').update(`${userId}:${targetLanguage}`).digest('hex')

// Idempotent get-or-create for the synthetic per-(user, target_language)
// adhoc session. First call creates content_source + text_track + study_session.
// Subsequent calls reuse them.
//
// Concurrency-safe: the partial unique index
// `content_sources_adhoc_user_language_unique` makes the content_sources
// upsert race-free, and finding an existing session keys off the same
// (user, target_language) tuple. The track lookup is by deterministic hash,
// also race-free.
export const getOrCreateAdhocSession = async (params: {
  userId: string
  targetLanguage: string
  nativeLanguage: string
  cefrLevel: string
  deps: GetOrCreateAdhocSessionDependencies
}): Promise<{ session: DbStudySession; track: DbTextTrack }> => {
  const { userId, targetLanguage, nativeLanguage, cefrLevel, deps } = params

  const existingSession = await deps.studySessionsRepository.findAdhocForUserAndLanguage(userId, targetLanguage)
  if (existingSession) {
    const track = await deps.textTracksRepository.findById(existingSession.text_track_id)
    if (!track) throw new Error(`adhoc session ${existingSession.id} references missing track`)
    return { session: existingSession, track }
  }

  const contentSource = await deps.contentSourcesRepository.findOrCreateAdhoc({
    userId,
    language: targetLanguage,
    title: ADHOC_SOURCE_TITLE,
  })

  const trackHash = adhocTrackHash(userId, targetLanguage)
  const existingTrack = await deps.textTracksRepository.findByContentSourceLanguageAndHash({
    contentSourceId: contentSource.id,
    language: targetLanguage,
    hash: trackHash,
  })
  const track =
    existingTrack ??
    (await deps.textTracksRepository.insertTextTrack({
      contentSourceId: contentSource.id,
      source: 'paste',
      language: targetLanguage,
      externalId: null,
      hash: trackHash,
    }))

  // Re-check the session in case a concurrent call created it between our
  // first lookup and now (after the content_source upsert returned an
  // existing-row). Cheaper than dealing with a unique-violation on session
  // insert later.
  const racedSession = await deps.studySessionsRepository.findAdhocForUserAndLanguage(userId, targetLanguage)
  if (racedSession) return { session: racedSession, track }

  const session = await deps.studySessionsRepository.insertAdhocStudySession({
    userId,
    contentSourceId: contentSource.id,
    textTrackId: track.id,
    nativeLanguage,
    targetLanguage,
    cefrLevel,
    contextBlob: ADHOC_CONTEXT_BLOB,
  })
  if (!session) throw new Error('insertAdhocStudySession returned null')
  return { session, track }
}
