import { beginTx } from '../../transport/database/postgres-client'
import type {
  StudySessionsRepositoryInterface,
  DbStudySession,
} from '../../transport/database/study-sessions/study-sessions-repository'
import type { SharedContentEntriesRepositoryInterface } from '../../transport/database/shared-content-entries/shared-content-entries-repository'
import type { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import type { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { getLanguageMode } from '../user-prefs/language-mode'

export type AddToLibraryDeps = {
  sharedContentEntriesRepository: SharedContentEntriesRepositoryInterface
  studySessionsRepository: StudySessionsRepositoryInterface
  usersRepository: UsersRepositoryInterface
  targetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface
}

export type AddToLibraryResult =
  | { kind: 'added'; session: DbStudySession; alreadyExisted: boolean; targetLanguage: string }
  | { kind: 'entry-not-live' }
  | { kind: 'cefr-required'; language: string }
  | { kind: 'track-missing' }

// One-tap add of a catalog entry to the caller's library. The catalog is the
// only place other users' source/track ids become reachable, so authorization
// is "the entry is live" — checked under a row lock in the same transaction as
// the session insert, which means an admin removal or owner unshare that
// commits first can never be added afterwards.
export const addSharedEntryToLibrary = async (
  params: { entryId: string; userId: string; snapshotNativeLanguage: string },
  deps: AddToLibraryDeps
): Promise<AddToLibraryResult> => {
  const entry = await deps.sharedContentEntriesRepository.findById(params.entryId)
  if (!entry || entry.unshared_at !== null || entry.removed_at !== null) return { kind: 'entry-not-live' }

  // CEFR comes from the user's per-language prefs (there is no client-side
  // wizard step on this path) — a missing row sends the client to the CEFR
  // dialog first.
  const prefs = await deps.targetLanguagePrefsRepository.findForLanguage(params.userId, entry.language)
  const cefrLevel = prefs?.cefr_level
  if (!cefrLevel) return { kind: 'cefr-required', language: entry.language }

  const languageMode = await getLanguageMode({
    userId: params.userId,
    targetLanguage: entry.language,
    usersRepository: deps.usersRepository,
    targetLanguagePrefsRepository: deps.targetLanguagePrefsRepository,
    snapshotNativeLanguage: params.snapshotNativeLanguage,
  })

  const inserted = await beginTx(async (tx) => {
    const live = await deps.sharedContentEntriesRepository.lockLiveById(params.entryId, tx)
    if (!live) return null
    return await deps.studySessionsRepository.insertStudySessionOn(tx, {
      userId: params.userId,
      contentSourceId: live.content_source_id,
      textTrackId: live.text_track_id,
      nativeLanguage: languageMode.nativeLanguage ?? params.snapshotNativeLanguage,
      targetLanguage: live.language,
      cefrLevel,
    })
  })

  if (inserted === null) {
    // Disambiguate: the entry died between the probe and the lock, or the
    // insert found no track (impossible while the composite FK holds).
    const recheck = await deps.sharedContentEntriesRepository.findById(params.entryId)
    if (!recheck || recheck.unshared_at !== null || recheck.removed_at !== null) return { kind: 'entry-not-live' }
    return { kind: 'track-missing' }
  }
  return {
    kind: 'added',
    session: inserted.session,
    alreadyExisted: inserted.alreadyExisted,
    targetLanguage: entry.language,
  }
}
