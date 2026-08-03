import type { LemmaRanksRepositoryInterface } from '../../transport/database/lemma-ranks/lemma-ranks-repository'
import type { ProcessingJobsRepositoryInterface } from '../../transport/database/processing-jobs/processing-jobs-repository'
import type { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'
import type { DbTextTrackWithSourceType } from '../../transport/database/text-tracks/text-tracks-repository'
import type { TextTracksRepositoryInterface } from '../../transport/database/text-tracks/text-tracks-repository'
import { ensureTrackLemmaProfileJob } from './ensure-profile-job'

// The single source of truth for the profile lifecycle at read time, shared by
// every consumer of the stored profile (the difficulty batch AND the
// whole-text mark-known preview/sweep). Centralizing it keeps the terminal
// 'failed' state honest on every path: a build whose queue retries are
// exhausted must never be silently re-enqueued by a polling client — that
// would loop forever (poll → enqueue → fail → poll …). Only explicit
// re-ingestion (ensure at track creation) or genuinely new segment drift may
// retry a failed build.
//
// The caller has already gated synthetic sources and unsupported languages —
// this resolver only answers "can the stored profile be used right now?".
export type TrackProfileReadiness = 'available' | 'pending' | 'failed'

export type ProfileReadinessDependencies = {
  textTracksRepository: TextTracksRepositoryInterface
  textSegmentsRepository: TextSegmentsRepositoryInterface
  processingJobsRepository: ProcessingJobsRepositoryInterface
  lemmaRanksRepository: LemmaRanksRepositoryInterface
}

export const resolveTrackProfileReadiness = async (
  track: DbTextTrackWithSourceType,
  userId: string,
  deps: ProfileReadinessDependencies
): Promise<TrackProfileReadiness> => {
  if (track.profile_built_at === null) {
    // 'failed' wins over enqueueing: after a terminal job failure the live-job
    // unique index no longer coalesces (the failed row is not live), so an
    // unconditional ensure here would mint a fresh job on every poll.
    const latestJobStatus = await deps.processingJobsRepository.getLatestBuildProfileJobStatus(track.id)
    if (latestJobStatus === 'failed') return 'failed'
    await ensureTrackLemmaProfileJob({ textTrackId: track.id, userId }, deps)
    return 'pending'
  }

  // Cheap staleness check: non-synthetic tracks are immutable after import, so
  // drift means the invariant broke — rebuild rather than serve a stat (or
  // sweep) computed over the wrong text. A rebuild that itself terminally
  // failed keeps the drift, so it must surface as 'failed', not re-enqueue.
  const stats = await deps.textSegmentsRepository.getSegmentStats(track.id)
  if (stats.segmentCount !== track.profile_segment_count || stats.maxIndex !== track.profile_max_segment_index) {
    const latestJobStatus = await deps.processingJobsRepository.getLatestBuildProfileJobStatus(track.id)
    if (latestJobStatus === 'failed') return 'failed'
    await deps.processingJobsRepository.enqueueBuildTrackLemmaProfile({ textTrackId: track.id, userId })
    return 'pending'
  }

  // A stamped profile whose build matched ZERO tokens over a non-empty text is
  // the fingerprint of a build that ran while the wiktionary/rank reference
  // data was missing or mid-reload: it reads as 'available' forever while
  // every consumer (difficulty stat, mark-known sweep) computes over nothing.
  // Rebuild only when the language's ranks were (re)built AFTER the profile —
  // a zero-match profile newer than the current reference data is genuinely
  // empty and must stay 'available' rather than rebuild-loop on every poll.
  if ((track.profile_word_token_count ?? 0) > 0 && track.profile_matched_token_count === 0) {
    const rankBuildTime = await deps.lemmaRanksRepository.getRankBuildTime(track.language)
    if (rankBuildTime !== null && new Date(track.profile_built_at).getTime() < rankBuildTime.getTime()) {
      const latestJobStatus = await deps.processingJobsRepository.getLatestBuildProfileJobStatus(track.id)
      if (latestJobStatus === 'failed') return 'failed'
      await deps.processingJobsRepository.enqueueBuildTrackLemmaProfile({ textTrackId: track.id, userId })
      return 'pending'
    }
  }

  return 'available'
}
