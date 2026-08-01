import type {
  ContentSourcesRepositoryInterface,
  DbContentSource,
} from '../../transport/database/content-sources/content-sources-repository'
import type {
  TextTracksRepositoryInterface,
  DbTextTrack,
} from '../../transport/database/text-tracks/text-tracks-repository'
import type { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'
import type { SharedContentEntriesRepositoryInterface } from '../../transport/database/shared-content-entries/shared-content-entries-repository'
import type { AuthUsersRepository } from '../../transport/database/auth-users/auth-users-repository'
import type { AnthropicPassesInterface } from '../../transport/third-party/anthropic/anthropic-passes'
import { logError } from '../../transport/error-monitoring/error-monitoring'
import { moderateIngestText } from '../moderation/moderate-ingest-text'
import { canonicalKeyForShare, isShareAllowed, PublishTrigger } from './shareability'

export type PublishSharedContentDeps = {
  contentSourcesRepository: ContentSourcesRepositoryInterface
  textTracksRepository: TextTracksRepositoryInterface
  textSegmentsRepository: TextSegmentsRepositoryInterface
  sharedContentEntriesRepository: SharedContentEntriesRepositoryInterface
  authUsersRepository: AuthUsersRepository
  anthropicPasses: AnthropicPassesInterface
}

export type PublishOutcome =
  | 'published'
  | 'not-shareable'
  | 'not-owner'
  | 'anonymous-user'
  | 'moderation-not-clean'
  | 'title-not-clean'
  | 'already-exists-or-conflict'

// A track is publishable only on an explicit 'clean'. NULL means unchecked:
// for YouTube (the one shareable surface whose ingest is not moderation-gated)
// the check runs here, at share time, and the verdict is persisted so the
// track is never re-checked — including 'blocked', which the gated surfaces
// never need to store because they reject before insert.
const resolveTrackModerationStatus = async (
  track: DbTextTrack,
  deps: PublishSharedContentDeps
): Promise<string | null> => {
  if (track.moderation_status !== null) return track.moderation_status
  const segments = await deps.textSegmentsRepository.listByTrackId(track.id)
  const text = segments.map((s) => s.text).join('\n')
  const outcome = await moderateIngestText(text, deps.anthropicPasses, { surface: 'share-youtube' })
  // The backfill is first-verdict-wins, so gate on what it returns (the
  // persisted status), never on this call's own outcome: a concurrent check
  // may have stored 'flagged' while this one came back 'clean'.
  if (!outcome.allowed) {
    return await deps.textTracksRepository.backfillModeration(track.id, {
      status: 'blocked',
      category: outcome.category,
    })
  }
  if (outcome.status === null) return null
  return await deps.textTracksRepository.backfillModeration(track.id, {
    status: outcome.status,
    category: outcome.category,
  })
}

// The title is the public payload of a catalog entry, and no ingest path
// moderates it as a standalone string (paste moderation covers segment text
// only; YouTube titles are client-sent). One short Haiku call at publish time.
const isTitleClean = async (title: string, deps: PublishSharedContentDeps): Promise<boolean> => {
  const outcome = await moderateIngestText(title, deps.anthropicPasses, { surface: 'share-title' })
  return outcome.allowed && outcome.status === 'clean'
}

// The single entry point for putting content into the Explore catalog.
// Idempotent and quiet: every ineligibility is a skip, not an error — callers
// on the ingest paths fire-and-forget it.
export const publishIfEligible = async (
  params: { contentSourceId: string; textTrackId: string; userId: string; trigger: PublishTrigger },
  deps: PublishSharedContentDeps
): Promise<PublishOutcome> => {
  const source = await deps.contentSourcesRepository.findById(params.contentSourceId)
  if (!source || !isShareAllowed(source.type, params.trigger)) return 'not-shareable'
  if (source.created_by_user_id !== params.userId) return 'not-owner'
  if (await deps.authUsersRepository.isAnonymous(params.userId)) return 'anonymous-user'

  const track = await deps.textTracksRepository.findById(params.textTrackId)
  if (!track || track.content_source_id !== source.id) return 'not-shareable'

  // Cheap exit before any LLM call: the extension re-fires ingest on every
  // video load, and an existing row (live, unshared, or tombstoned) means
  // there is nothing to publish.
  if (await deps.sharedContentEntriesRepository.findByTextTrackId(track.id)) return 'already-exists-or-conflict'

  const moderationStatus = await resolveTrackModerationStatus(track, deps)
  if (moderationStatus !== 'clean') return 'moderation-not-clean'
  if (!(await isTitleClean(source.title, deps))) return 'title-not-clean'

  const entry = await deps.sharedContentEntriesRepository.insertIfPublishable({
    contentSourceId: source.id,
    textTrackId: track.id,
    canonicalKey: canonicalKeyForShare(source, track),
    language: track.language,
    sharedByUserId: params.userId,
    // The insert aborts if the source title changed since the check above —
    // otherwise a concurrent re-ingest could swap in an unmoderated title
    // right before the entry goes live, too early for the title fence to see
    // a live entry.
    moderatedTitle: source.title,
  })
  return entry ? 'published' : 'already-exists-or-conflict'
}

export type ReshareOutcome = 'reshared' | 'moderation-not-clean' | 'title-not-clean' | 'conflict'

// Owner opt-in on an EXISTING (unshared) entry. The row's existence proves
// nothing about eligibility: an opt-out row can predate any publish (so the
// track may never have been moderated at all), the title may have mutated
// since the entry last went live, and an admin may have tombstoned another
// copy of the same canonical content. Re-run the full gate before flipping
// the row back to live. The caller owns authorization (owner, non-anonymous,
// shareable type) — this covers content eligibility only.
export const reshareIfEligible = async (
  params: { source: DbContentSource; track: DbTextTrack },
  deps: PublishSharedContentDeps
): Promise<ReshareOutcome> => {
  const moderationStatus = await resolveTrackModerationStatus(params.track, deps)
  if (moderationStatus !== 'clean') return 'moderation-not-clean'
  if (!(await isTitleClean(params.source.title, deps))) return 'title-not-clean'
  const outcome = await deps.sharedContentEntriesRepository.reshare({
    textTrackId: params.track.id,
    contentSourceId: params.source.id,
    canonicalKey: canonicalKeyForShare(params.source, params.track),
    moderatedTitle: params.source.title,
  })
  return outcome === 'reshared' ? 'reshared' : 'conflict'
}

// Fire-and-forget wrapper for the ingest paths: never throws, never blocks.
export const autoShareInBackground = (
  params: { contentSourceId: string; textTrackId: string; userId: string },
  deps: PublishSharedContentDeps
): void => {
  void publishIfEligible({ ...params, trigger: 'auto' }, deps).catch((error) => {
    logError({
      message: 'auto-share publish failed',
      params: { contentSourceId: params.contentSourceId, textTrackId: params.textTrackId },
      error,
    })
  })
}

// Title-change fence: re-ingests overwrite the SOURCE title (and a changed
// subtitle hash creates a sibling track), so any live entry on the source may
// suddenly display a title that was never checked. If the new title is not
// clean, every live entry on the source comes down.
export const recheckTitleForSharedSource = (
  params: { contentSourceId: string; title: string },
  deps: PublishSharedContentDeps
): void => {
  void (async () => {
    if (!(await deps.sharedContentEntriesRepository.hasLiveEntriesForSource(params.contentSourceId))) return
    if (await isTitleClean(params.title, deps)) return
    await deps.sharedContentEntriesRepository.unshareAllLiveForSource(params.contentSourceId)
  })().catch((error) => {
    logError({
      message: 'shared-content title recheck failed',
      params: { contentSourceId: params.contentSourceId },
      error,
    })
  })
}
