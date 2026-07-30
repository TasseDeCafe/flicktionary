import { KAIKKI_LANGUAGES } from '@flicktionary/core/constants/language-grammar'
import type { ProcessingJobsRepositoryInterface } from '../../transport/database/processing-jobs/processing-jobs-repository'
import type { TextTracksRepositoryInterface } from '../../transport/database/text-tracks/text-tracks-repository'
import { logError } from '../../transport/error-monitoring/error-monitoring'

export type EnsureTrackLemmaProfileJobDependencies = {
  textTracksRepository: TextTracksRepositoryInterface
  processingJobsRepository: ProcessingJobsRepositoryInterface
}

// Called at every prose-track creation point (SRT upload, OpenSubtitles,
// paste, extension YouTube/streaming ingest, text import): enqueue a
// build_track_lemma_profile job when the track can have a profile and doesn't
// yet. The live-job unique index coalesces concurrent enqueues; checking
// profile_built_at keeps idempotent re-ingests (extension re-registers on
// every video load) from re-running finished builds. Never throws — a missing
// profile only delays the difficulty stat; the import itself must not fail
// over it.
export const ensureTrackLemmaProfileJob = async (
  params: { textTrackId: string; userId: string },
  deps: EnsureTrackLemmaProfileJobDependencies
): Promise<void> => {
  try {
    const track = await deps.textTracksRepository.findByIdWithSourceType(params.textTrackId)
    if (!track || track.profile_built_at !== null) return
    if (track.content_source_type === 'adhoc' || track.content_source_type === 'lesson') return
    if (!KAIKKI_LANGUAGES.has(track.language)) return
    await deps.processingJobsRepository.enqueueBuildTrackLemmaProfile({
      textTrackId: params.textTrackId,
      userId: params.userId,
    })
  } catch (error) {
    logError({
      message: 'ensureTrackLemmaProfileJob failed',
      params: { textTrackId: params.textTrackId, userId: params.userId },
      error,
    })
  }
}
