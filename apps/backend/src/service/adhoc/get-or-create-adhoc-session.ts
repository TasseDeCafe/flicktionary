import { createHash } from 'node:crypto'
import { DbTextTrack } from '../../transport/database/text-tracks/text-tracks-repository'
import {
  StudySessionsRepositoryInterface,
  DbStudySession,
} from '../../transport/database/study-sessions/study-sessions-repository'
import { ADHOC_CONTEXT_BLOB, ADHOC_SOURCE_TITLE } from './constants'

export type GetOrCreateAdhocSessionDependencies = {
  studySessionsRepository: StudySessionsRepositoryInterface
}

// Deterministic per-(user, language) track hash so the (content_source_id,
// language, hash) unique constraint never blocks the second call. Not
// load-bearing for security — adhoc tracks aren't shared across users —
// just a stable string to satisfy the schema.
const adhocTrackHash = (userId: string, targetLanguage: string): string =>
  'adhoc:' + createHash('sha256').update(`${userId}:${targetLanguage}`).digest('hex')

// Idempotent get-or-create for the synthetic per-(user, target_language) adhoc
// session. The repository method owns the cross-table transaction and advisory
// lock because the invariant spans content_sources, text_tracks, and
// study_sessions. Existing sessions are refreshed with the user's current
// native language and CEFR so later chat/exploration uses the same prefs as the
// just-created ad-hoc card.
export const getOrCreateAdhocSession = async (params: {
  userId: string
  targetLanguage: string
  nativeLanguage: string
  cefrLevel: string
  deps: GetOrCreateAdhocSessionDependencies
}): Promise<{ session: DbStudySession; track: DbTextTrack }> => {
  const { userId, targetLanguage, nativeLanguage, cefrLevel, deps } = params

  return deps.studySessionsRepository.getOrCreateAdhocStudySession({
    userId,
    targetLanguage,
    nativeLanguage,
    cefrLevel,
    title: ADHOC_SOURCE_TITLE,
    trackHash: adhocTrackHash(userId, targetLanguage),
    contextBlob: ADHOC_CONTEXT_BLOB,
  })
}
