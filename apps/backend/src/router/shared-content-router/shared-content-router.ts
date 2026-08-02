import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import { sharedContentContract } from '@flicktionary/api-client/orpc-contracts/shared-content-contract'
import { ERROR_CODE_FOR_CEFR_REQUIRED } from '@flicktionary/api-client/key-generation/frontend-api-key-constants'
import { assertTestUser, isTestUserEmail } from '../orpc/helpers/assert-test-user'
import type {
  SharedContentEntriesRepositoryInterface,
  DbSharedContentEntry,
  DbSharedContentEntryWithSource,
} from '../../transport/database/shared-content-entries/shared-content-entries-repository'
import type { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import type { ContentSourcesRepositoryInterface } from '../../transport/database/content-sources/content-sources-repository'
import type { TextTracksRepositoryInterface } from '../../transport/database/text-tracks/text-tracks-repository'
import type { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import type {
  TextSegmentsRepositoryInterface,
  DbTextSegment,
} from '../../transport/database/text-segments/text-segments-repository'
import type { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { logError } from '../../transport/error-monitoring/error-monitoring'
import { addSharedEntryToLibrary } from '../../service/shared-content/add-to-library'
import {
  publishIfEligible,
  reshareIfEligible,
  type PublishSharedContentDeps,
} from '../../service/shared-content/publish-shared-content'
import { canonicalKeyForShare, SHARE_MODE_BY_SOURCE_TYPE } from '../../service/shared-content/shareability'
import { toStudySessionDto } from '../study-sessions-router/study-sessions-router'

const FEED_LIMIT = 100
const ADMIN_LIST_LIMIT = 200

const readMetaString = (metadata: Record<string, unknown>, key: string): string | null => {
  const value = metadata[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

// Only the registrable host of an imported article's URL is public — the full
// URL is whatever the extension saw in the tab bar (possibly signed or
// private) and never leaves the source metadata.
const domainFromUrl = (url: string | null): string | null => {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

const toEntryDto = (row: DbSharedContentEntryWithSource) => ({
  id: row.id,
  language: row.language,
  title: row.title,
  type: row.type,
  youtubeVideoId: row.type === 'youtube' ? readMetaString(row.metadata, 'youtubeVideoId') : null,
  sourceDomain: domainFromUrl(readMetaString(row.metadata, 'sourceUrl')),
  featured: row.featured,
  createdAt: new Date(row.created_at).toISOString(),
})

const entryStatus = (row: DbSharedContentEntry): 'live' | 'unshared' | 'removed' =>
  row.removed_at !== null ? 'removed' : row.unshared_at !== null ? 'unshared' : 'live'

const toEntryDetailDto = (row: DbSharedContentEntryWithSource, segments: DbTextSegment[], isAdmin: boolean) => ({
  ...toEntryDto(row),
  text: segments.map((segment) => segment.text).join('\n'),
  segmentCount: segments.length,
  status: entryStatus(row),
  // The removal reason is moderation bookkeeping, not public copy.
  removedReason: isAdmin ? row.removed_reason : null,
})

const toAdminEntryDto = (row: DbSharedContentEntryWithSource) => ({
  ...toEntryDto(row),
  status: entryStatus(row),
  contentSourceId: row.content_source_id,
  textTrackId: row.text_track_id,
  canonicalKey: row.canonical_key,
  sharedByUserId: row.shared_by_user_id,
  removedReason: row.removed_reason,
})

export type SharedContentRouterDeps = {
  sharedContentEntriesRepository: SharedContentEntriesRepositoryInterface
  studySessionsRepository: StudySessionsRepositoryInterface
  contentSourcesRepository: ContentSourcesRepositoryInterface
  textTracksRepository: TextTracksRepositoryInterface
  usersRepository: UsersRepositoryInterface
  targetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface
  textSegmentsRepository: TextSegmentsRepositoryInterface
  publishDeps: PublishSharedContentDeps
}

export const SharedContentRouter = (deps: SharedContentRouterDeps): Router => {
  const implementer = implement(sharedContentContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

  // The owner-side share state for a track, shared by getShareState (quiet)
  // and setShared (throwing). 'unmanageable' covers everything that must not
  // show a toggle: foreign tracks, non-shareable types, guests, tombstones.
  const resolveOwnedShareContext = async (textTrackId: string, userId: string) => {
    const track = await deps.textTracksRepository.findById(textTrackId)
    if (!track) return null
    const source = await deps.contentSourcesRepository.findById(track.content_source_id)
    if (!source) return null
    if (SHARE_MODE_BY_SOURCE_TYPE[source.type] === 'none') return null
    if (source.created_by_user_id !== userId) return null
    if (await deps.publishDeps.authUsersRepository.isAnonymous(userId)) return null
    const entry = await deps.sharedContentEntriesRepository.findByTextTrackId(track.id)
    if (entry?.removed_at) return null
    return { track, source, entry }
  }

  const router = implementer.router({
    list: implementer.list.handler(async ({ input, context }) => {
      const entries = await deps.sharedContentEntriesRepository.listLive({
        viewerUserId: context.res.locals.userId,
        language: input.language ?? null,
        featuredOnly: input.featuredOnly ?? false,
        limit: FEED_LIMIT,
      })
      return { data: entries.map((row) => ({ ...toEntryDto(row), inLibrary: row.in_library })) }
    }),

    get: implementer.get.handler(async ({ input, context, errors }) => {
      // Admins can open non-live entries — moderating a tombstone (or judging
      // an unshare) requires seeing the content. The public path stays
      // live-only.
      const isAdmin = isTestUserEmail(context.res.locals.email)
      const row = await deps.sharedContentEntriesRepository.findByIdWithSource(input.entryId)
      if (!row || (!isAdmin && entryStatus(row) !== 'live')) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'This content is no longer shared' }] },
        })
      }
      const segments = await deps.textSegmentsRepository.listByTrackId(row.text_track_id)
      return { data: toEntryDetailDto(row, segments, isAdmin) }
    }),

    addToLibrary: implementer.addToLibrary.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const result = await addSharedEntryToLibrary(
        { entryId: input.entryId, userId, snapshotNativeLanguage: input.nativeLanguage },
        {
          sharedContentEntriesRepository: deps.sharedContentEntriesRepository,
          studySessionsRepository: deps.studySessionsRepository,
          usersRepository: deps.usersRepository,
          targetLanguagePrefsRepository: deps.targetLanguagePrefsRepository,
        }
      )
      if (result.kind === 'entry-not-live') {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'This content is no longer shared' }] },
        })
      }
      if (result.kind === 'cefr-required') {
        throw errors.UNPROCESSABLE_ENTITY({
          data: {
            errors: [{ code: ERROR_CODE_FOR_CEFR_REQUIRED, message: 'Pick your level for this language first' }],
          },
        })
      }
      if (result.kind === 'track-missing') {
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Shared content is missing its text track' }] },
        })
      }
      const enriched = await deps.studySessionsRepository.findByIdForUserWithSource(result.session.id, userId)
      if (!enriched) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Failed to load created study session' }] },
        })
      }
      void deps.usersRepository.setLastTargetLanguage(userId, result.targetLanguage).catch((error) => {
        logError({
          message: 'setLastTargetLanguage failed',
          params: { userId, targetLanguage: result.targetLanguage },
          error,
        })
      })
      return { data: toStudySessionDto(enriched), alreadyExisted: result.alreadyExisted }
    }),

    getShareState: implementer.getShareState.handler(async ({ input, context }) => {
      const userId = context.res.locals.userId
      const owned = await resolveOwnedShareContext(input.textTrackId, userId)
      if (!owned) return { data: { state: 'not-shareable' as const } }
      const live = owned.entry && owned.entry.unshared_at === null
      return { data: { state: live ? ('shared' as const) : ('not-shared' as const) } }
    }),

    setShared: implementer.setShared.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const owned = await resolveOwnedShareContext(input.textTrackId, userId)
      if (!owned) {
        throw errors.FORBIDDEN({
          data: { errors: [{ message: 'This content cannot be shared from this account' }] },
        })
      }

      if (!input.shared) {
        // Upsert so an opt-out row exists even before a pending background
        // publish lands — its ON CONFLICT DO NOTHING then keeps the opt-out.
        await deps.sharedContentEntriesRepository.upsertUnshared({
          contentSourceId: owned.source.id,
          textTrackId: owned.track.id,
          canonicalKey: canonicalKeyForShare(owned.source, owned.track),
          language: owned.track.language,
          sharedByUserId: userId,
        })
        return { data: { state: 'not-shared' as const } }
      }

      if (owned.entry) {
        // The existing row may be a pre-publish opt-out (track never
        // moderated) or predate a title change / cross-copy tombstone —
        // resharing re-runs the full eligibility gate, not just the flip.
        const reshared = await reshareIfEligible({ source: owned.source, track: owned.track }, deps.publishDeps)
        if (reshared === 'reshared') return { data: { state: 'shared' as const } }
        if (reshared === 'moderation-not-clean' || reshared === 'title-not-clean') {
          throw errors.CONFLICT({
            data: { errors: [{ message: "This content didn't pass the sharing moderation check" }] },
          })
        }
        throw errors.CONFLICT({
          data: { errors: [{ message: 'This content is already shared by someone else or was removed' }] },
        })
      }

      const outcome = await publishIfEligible(
        { contentSourceId: owned.source.id, textTrackId: owned.track.id, userId, trigger: 'user' },
        deps.publishDeps
      )
      if (outcome === 'published') return { data: { state: 'shared' as const } }
      if (outcome === 'moderation-not-clean' || outcome === 'title-not-clean') {
        throw errors.CONFLICT({
          data: { errors: [{ message: "This content didn't pass the sharing moderation check" }] },
        })
      }
      if (outcome === 'already-exists-or-conflict') {
        throw errors.CONFLICT({
          data: { errors: [{ message: 'This content is already shared by someone else' }] },
        })
      }
      throw errors.FORBIDDEN({
        data: { errors: [{ message: 'This content cannot be shared from this account' }] },
      })
    }),

    adminList: implementer.adminList.handler(async ({ input, context }) => {
      assertTestUser(context.res.locals.email)
      const entries = await deps.sharedContentEntriesRepository.listForAdmin(ADMIN_LIST_LIMIT, input.status ?? null)
      return { data: entries.map(toAdminEntryDto) }
    }),

    adminRemove: implementer.adminRemove.handler(async ({ input, context, errors }) => {
      assertTestUser(context.res.locals.email)
      const removed = await deps.sharedContentEntriesRepository.removeAsAdmin(input.entryId, input.reason)
      const withSource = removed && (await deps.sharedContentEntriesRepository.findByIdWithSource(removed.id))
      if (!withSource) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Shared content entry not found' }] } })
      }
      return { data: toAdminEntryDto(withSource) }
    }),

    adminSetFeatured: implementer.adminSetFeatured.handler(async ({ input, context, errors }) => {
      assertTestUser(context.res.locals.email)
      const updated = await deps.sharedContentEntriesRepository.setFeatured(input.entryId, input.featured)
      const withSource = updated && (await deps.sharedContentEntriesRepository.findByIdWithSource(updated.id))
      if (!withSource) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Shared content entry not found' }] } })
      }
      return { data: toAdminEntryDto(withSource) }
    }),
  })

  return createOrpcExpressRouter(router, { contract: sharedContentContract })
}
