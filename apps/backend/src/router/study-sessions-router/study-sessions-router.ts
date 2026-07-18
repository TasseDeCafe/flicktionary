import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import { studySessionsContract } from '@flicktionary/api-client/orpc-contracts/study-sessions-contract'
import {
  DbStudySessionWithSource,
  DbTextSegment,
  StudySessionsRepositoryInterface,
} from '../../transport/database/study-sessions/study-sessions-repository'
import { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import { ProcessingJobsRepositoryInterface } from '../../transport/database/processing-jobs/processing-jobs-repository'
import { TextTracksRepositoryInterface } from '../../transport/database/text-tracks/text-tracks-repository'
import { HighlightsRepositoryInterface } from '../../transport/database/highlights/highlights-repository'
import { logWithSentry } from '../../transport/third-party/sentry/error-monitoring'
import { getLanguageMode } from '../../service/user-prefs/language-mode'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { importTextForUser, resolveIngestPrefs } from '../../service/study-sessions/import-text'
import { ensureTrackLemmaProfileJob } from '../../service/lemma-profiles/ensure-profile-job'
import type { AnthropicPassesInterface } from '../../transport/third-party/anthropic/anthropic-passes'
import {
  collectCheckpoint,
  previewCheckpoint,
  type CheckpointDependencies,
} from '../../service/checkpoint/collect-checkpoint'
import { undoCheckpoint } from '../../service/checkpoint/undo-checkpoint'
import { assertKnownBacklog, undoKnownAssertions } from '../../service/checkpoint/assert-known'

const readPosterUrl = (metadata: Record<string, unknown> | null): string | null => {
  const v = metadata?.posterUrl
  return typeof v === 'string' ? v : null
}

const readYear = (metadata: Record<string, unknown> | null): number | null => {
  const v = metadata?.year
  return typeof v === 'number' ? v : null
}

const readMetaString = (metadata: Record<string, unknown> | null, key: string): string | null => {
  const v = metadata?.[key]
  return typeof v === 'string' ? v : null
}

const readMetaInt = (metadata: Record<string, unknown> | null, key: string): number | null => {
  const v = metadata?.[key]
  return typeof v === 'number' ? v : null
}

const toSegmentDto = (row: DbTextSegment) => ({
  id: row.id,
  index: row.index,
  text: row.text,
  startMs: row.start_ms,
  endMs: row.end_ms,
})

const toStudySessionDto = (row: DbStudySessionWithSource) => ({
  id: row.id,
  userId: row.user_id,
  contentSourceId: row.content_source_id,
  textTrackId: row.text_track_id,
  nativeLanguage: row.native_language,
  targetLanguage: row.target_language,
  cefrLevel: row.cefr_level,
  contextBlob: row.context_blob,
  processingWarnings: row.processing_warnings,
  furthestReadSegmentIndex: row.furthest_read_segment_index,
  reviewedUntilSegmentIndex: row.reviewed_until_segment_index,
  createdAt: new Date(row.created_at).toISOString(),
  contentSourceTitle: row.content_source_title,
  contentSourceType: row.content_source_type,
  contentSourcePosterUrl: readPosterUrl(row.content_source_metadata),
  contentSourceYear: readYear(row.content_source_metadata),
  tmdbShowId: readMetaInt(row.content_source_metadata, 'tmdbShowId'),
  seasonNumber: readMetaInt(row.content_source_metadata, 'seasonNumber'),
  episodeNumber: readMetaInt(row.content_source_metadata, 'episodeNumber'),
  showTitle: readMetaString(row.content_source_metadata, 'showTitle'),
  originalTitle: readMetaString(row.content_source_metadata, 'originalTitle'),
  episodeTitle: readMetaString(row.content_source_metadata, 'episodeTitle'),
})

export const StudySessionsRouter = (
  studySessionsRepository: StudySessionsRepositoryInterface,
  usersRepository: UsersRepositoryInterface,
  targetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface,
  processingJobsRepository: ProcessingJobsRepositoryInterface,
  textTracksRepository: TextTracksRepositoryInterface,
  highlightsRepository: HighlightsRepositoryInterface,
  anthropicPasses: AnthropicPassesInterface,
  checkpointDependencies: CheckpointDependencies
): Router => {
  const implementer = implement(studySessionsContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

  // Ingest-prefs resolution + one-shot text import live in the shared service
  // (service/study-sessions/import-text.ts) — the Telegram bot runs the same
  // flow outside oRPC. The handlers here only map failures to typed errors.
  const importTextDeps = {
    anthropicPasses,
    studySessionsRepository,
    usersRepository,
    userTargetLanguagePrefsRepository: targetLanguagePrefsRepository,
    textTracksRepository,
    processingJobsRepository,
  }

  const resolveExtensionIngestPrefs = (userId: string, segments: ReadonlyArray<{ text: string }>) =>
    resolveIngestPrefs(userId, segments, importTextDeps)

  // Build the UNPROCESSABLE_ENTITY error body for a failed prefs resolution.
  // The handler throws its own typed `errors.UNPROCESSABLE_ENTITY({ data })` —
  // this just shares the code/message shaping between the ingest flows.
  const ingestPrefsErrorData = (
    prefs:
      { reason: 'unsupported' } | { reason: 'needs-onboarding' } | { reason: 'missing-cefr'; targetLanguage: string }
  ) => {
    if (prefs.reason === 'unsupported') {
      return {
        errors: [
          { code: 'UNSUPPORTED_LANGUAGE', message: 'This content is not in a language Flicktionary supports yet.' },
        ],
      }
    }
    if (prefs.reason === 'needs-onboarding') {
      return {
        errors: [
          {
            code: 'NEEDS_ONBOARDING',
            // The extension reads this code to drive the user into web
            // onboarding (which sets their native language), not a CEFR picker.
            message: 'Finish setting up Flicktionary to start saving words.',
          },
        ],
      }
    }
    return {
      errors: [
        {
          code: 'MISSING_CEFR',
          message: `Set your ${getLanguageName(prefs.targetLanguage)} level on flicktionary.app before saving from the extension.`,
          // The extension reads this to offer an inline CEFR picker for the
          // detected language rather than sending the user to the app.
          targetLanguage: prefs.targetLanguage,
        },
      ],
    }
  }

  const router = implementer.router({
    list: implementer.list.handler(async ({ context }) => {
      const userId = context.res.locals.userId
      const sessions = await studySessionsRepository.listByUserIdWithSource(userId)
      return { data: sessions.map(toStudySessionDto) }
    }),

    get: implementer.get.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const session = await studySessionsRepository.findByIdForUserWithSource(input.sessionId, userId)
      if (!session) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Study session not found' }] },
        })
      }
      return { data: toStudySessionDto(session) }
    }),

    create: implementer.create.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const languagePrefs = await getLanguageMode({
        userId,
        targetLanguage: input.targetLanguage,
        snapshotNativeLanguage: input.nativeLanguage,
        usersRepository,
        targetLanguagePrefsRepository,
      })
      const inserted = await studySessionsRepository.insertStudySession({
        userId,
        contentSourceId: input.contentSourceId,
        textTrackId: input.textTrackId,
        nativeLanguage: languagePrefs.nativeLanguage ?? input.nativeLanguage,
        targetLanguage: input.targetLanguage,
        cefrLevel: input.cefrLevel,
      })
      if (!inserted) {
        throw errors.BAD_REQUEST({
          data: { errors: [{ message: 'Text track not found for content source' }] },
        })
      }
      // Re-fetch via the joined query so the returned DTO carries the source title
      // and poster — the wizard navigates straight to the session view.
      const enriched = await studySessionsRepository.findByIdForUserWithSource(inserted.id, userId)
      if (!enriched) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Failed to load created study session' }] },
        })
      }
      // Stamp the most-recent target language so the adhoc wizard can prefill it.
      void usersRepository.setLastTargetLanguage(userId, input.targetLanguage).catch((error) => {
        logWithSentry({
          message: 'setLastTargetLanguage failed',
          params: { userId, targetLanguage: input.targetLanguage },
          error,
        })
      })
      return { data: toStudySessionDto(enriched) }
    }),

    process: implementer.process.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const session = await studySessionsRepository.findByIdForUser(input.sessionId, userId)
      if (!session) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Study session not found' }] },
        })
      }
      // Highlights are enriched in the background as they're committed; Phase 2
      // ghost nomination replaced whole-text discovery. Process is now a
      // backwards-compatible no-op that lets old clients jump to session vocabulary without
      // mutating study_sessions.status.
      return { data: { accepted: true as const } }
    }),

    updateReadingProgress: implementer.updateReadingProgress.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const ok = await studySessionsRepository.updateReadingProgress(input.sessionId, userId, input.segmentIndex)
      if (!ok) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Study session not found' }] },
        })
      }
      return { data: { ok: true as const } }
    }),

    getCheckpointPreview: implementer.getCheckpointPreview.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const result = await previewCheckpoint(
        { sessionId: input.sessionId, userId, toSegmentIndex: input.toSegmentIndex },
        checkpointDependencies
      )
      if (!result.ok) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Study session not found' }] } })
      }
      return {
        data: { pendingCount: result.pendingCount, backlogCount: result.backlogCount, supported: result.supported },
      }
    }),

    collectCheckpoint: implementer.collectCheckpoint.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const result = await collectCheckpoint(
        {
          sessionId: input.sessionId,
          userId,
          toSegmentIndex: input.toSegmentIndex,
          previewedSpans: input.previewedSpans,
        },
        checkpointDependencies
      )
      if (!result.ok) {
        if (result.reason === 'not_found') {
          throw errors.NOT_FOUND({ data: { errors: [{ message: 'Study session not found' }] } })
        }
        if (result.reason === 'unsupported_language') {
          throw errors.UNPROCESSABLE_ENTITY({
            data: {
              errors: [
                {
                  code: 'UNSUPPORTED_LANGUAGE',
                  message: 'Checkpoint reviews are not available for this language yet.',
                },
              ],
            },
          })
        }
        throw errors.CONFLICT({
          data: { errors: [{ message: 'A concurrent checkpoint advanced the reading position. Retry.' }] },
        })
      }
      return {
        data: {
          checkpointId: result.checkpointId,
          fromSegmentIndex: result.fromSegmentIndex,
          toSegmentIndex: result.toSegmentIndex,
          creditedCount: result.creditedCount,
          suppressedCount: result.suppressedCount,
          backlogCandidates: result.backlogCandidates,
        },
      }
    }),

    undoCheckpoint: implementer.undoCheckpoint.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const result = await undoCheckpoint(
        { sessionId: input.sessionId, checkpointId: input.checkpointId, userId },
        checkpointDependencies
      )
      if (!result.ok) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Checkpoint not found' }] } })
      }
      return { data: { undone: result.undone, reverted: result.reverted, skipped: result.skipped } }
    }),

    assertKnownBacklog: implementer.assertKnownBacklog.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const result = await assertKnownBacklog(
        {
          sessionId: input.sessionId,
          checkpointId: input.checkpointId,
          userId,
          userLookupIds: input.userLookupIds,
        },
        checkpointDependencies
      )
      if (!result.ok) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Checkpoint not found' }] } })
      }
      return { data: { asserted: result.asserted, skipped: result.skipped } }
    }),

    undoKnownAssertions: implementer.undoKnownAssertions.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const result = await undoKnownAssertions(
        { sessionId: input.sessionId, checkpointId: input.checkpointId, userId },
        checkpointDependencies
      )
      if (!result.ok) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Checkpoint not found' }] } })
      }
      return { data: { reverted: result.reverted, skipped: result.skipped } }
    }),

    getProcessingStatus: implementer.getProcessingStatus.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const session = await studySessionsRepository.findByIdForUser(input.sessionId, userId)
      if (!session) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Study session not found' }] },
        })
      }
      const jobs = await processingJobsRepository.listActiveBySession(input.sessionId)
      const enrichingHighlightIds: string[] = []
      const failedHighlightIds: string[] = []
      // Seed-chat jobs are tracked separately from enrichment: a pending seeded
      // answer is not a missing card, so it must not show up as a session-vocabulary straggler.
      const seedChatHighlightIds: string[] = []
      const failedSeedChatHighlightIds: string[] = []
      for (const job of jobs) {
        if (!job.highlight_id) continue
        if (job.kind === 'enrich_highlight') {
          if (job.status === 'failed') failedHighlightIds.push(job.highlight_id)
          else enrichingHighlightIds.push(job.highlight_id)
        } else if (job.kind === 'seed_card_chat') {
          if (job.status === 'failed') failedSeedChatHighlightIds.push(job.highlight_id)
          else seedChatHighlightIds.push(job.highlight_id)
        }
      }
      return { data: { enrichingHighlightIds, failedHighlightIds, seedChatHighlightIds, failedSeedChatHighlightIds } }
    }),

    retryEnrichment: implementer.retryEnrichment.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const session = await studySessionsRepository.findByIdForUser(input.sessionId, userId)
      if (!session) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Study session not found' }] },
        })
      }
      const highlight = await highlightsRepository.findById(input.highlightId)
      if (!highlight || highlight.study_session_id !== input.sessionId) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Highlight not found' }] },
        })
      }
      const requeued = await processingJobsRepository.requeueFailedByHighlightId({
        sessionId: input.sessionId,
        highlightId: input.highlightId,
      })
      if (!requeued) {
        await processingJobsRepository.enqueue({
          kind: 'enrich_highlight',
          sessionId: input.sessionId,
          highlightId: input.highlightId,
          userId,
        })
      }
      return { data: { accepted: true as const } }
    }),

    getStatus: implementer.getStatus.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const session = await studySessionsRepository.findByIdForUser(input.sessionId, userId)
      if (!session) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Study session not found' }] },
        })
      }
      return {
        data: {
          processingWarnings: session.processing_warnings,
        },
      }
    }),

    getDeletePreview: implementer.getDeletePreview.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const preview = await studySessionsRepository.getDeletePreview(input.sessionId, userId)
      if (!preview) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Study session not found' }] },
        })
      }
      return { data: preview }
    }),

    findOrCreateForYoutubeVideo: implementer.findOrCreateForYoutubeVideo.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId

      const prefs = await resolveExtensionIngestPrefs(userId, input.subtitles.segments)
      if (!prefs.ok) {
        throw errors.UNPROCESSABLE_ENTITY({ data: ingestPrefsErrorData(prefs) })
      }
      const { detectedLanguage, nativeLanguage, cefrLevel } = prefs

      const { session, track, contentSource, segments } = await studySessionsRepository.getOrCreateForYoutubeVideo({
        userId,
        youtubeVideoId: input.youtubeVideoId,
        videoTitle: input.videoTitle,
        videoUrl: input.videoUrl,
        videoAudioLanguage: detectedLanguage,
        subtitleLanguage: detectedLanguage,
        subtitleHash: input.subtitles.contentHash,
        subtitleSegments: input.subtitles.segments,
        nativeLanguage,
        targetLanguage: detectedLanguage,
        cefrLevel,
      })

      // Stamp the most-recent target language so adhoc wizards and other
      // surfaces stay coherent with what was actually studied.
      void usersRepository.setLastTargetLanguage(userId, detectedLanguage).catch((error) => {
        logWithSentry({
          message: 'setLastTargetLanguage failed (youtube ingest)',
          params: { userId, targetLanguage: detectedLanguage },
          error,
        })
      })

      // Lemma-profile build for the difficulty stat — no-op on the idempotent
      // re-registers the extension fires on every video load.
      await ensureTrackLemmaProfileJob(
        { textTrackId: track.id, userId },
        { textTracksRepository, processingJobsRepository }
      )

      return {
        data: {
          sessionId: session.id,
          textTrackId: track.id,
          contentSourceId: contentSource.id,
          targetLanguage: session.target_language,
          segments: segments.map(toSegmentDto),
        },
      }
    }),

    findOrCreateForStreamingVideo: implementer.findOrCreateForStreamingVideo.handler(
      async ({ input, context, errors }) => {
        const userId = context.res.locals.userId

        const prefs = await resolveExtensionIngestPrefs(userId, input.subtitles.segments)
        if (!prefs.ok) {
          throw errors.UNPROCESSABLE_ENTITY({ data: ingestPrefsErrorData(prefs) })
        }
        const { detectedLanguage, nativeLanguage, cefrLevel } = prefs

        const { session, track, contentSource, segments } = await studySessionsRepository.getOrCreateForStreamingVideo({
          userId,
          videoTitle: input.videoTitle,
          videoUrl: input.videoUrl,
          contentHash: input.subtitles.contentHash,
          subtitleLanguage: detectedLanguage,
          subtitleSegments: input.subtitles.segments,
          nativeLanguage,
          targetLanguage: detectedLanguage,
          cefrLevel,
        })

        void usersRepository.setLastTargetLanguage(userId, detectedLanguage).catch((error) => {
          logWithSentry({
            message: 'setLastTargetLanguage failed (streaming ingest)',
            params: { userId, targetLanguage: detectedLanguage },
            error,
          })
        })

        await ensureTrackLemmaProfileJob(
          { textTrackId: track.id, userId },
          { textTracksRepository, processingJobsRepository }
        )

        return {
          data: {
            sessionId: session.id,
            textTrackId: track.id,
            contentSourceId: contentSource.id,
            targetLanguage: session.target_language,
            segments: segments.map(toSegmentDto),
          },
        }
      }
    ),

    lookupForVideo: implementer.lookupForVideo.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      if (input.source === 'youtube' && !input.youtubeVideoId) {
        throw errors.BAD_REQUEST({
          data: { errors: [{ message: 'youtubeVideoId is required for source=youtube' }] },
        })
      }
      // SELECT-only: no CEFR / language-detection requirements — this never
      // creates anything, it just resolves what an earlier ingest created.
      const found = await studySessionsRepository.findForVideo({
        userId,
        source: input.source,
        youtubeVideoId: input.youtubeVideoId,
        contentHash: input.contentHash,
      })
      if (!found) return { data: null }
      return {
        data: {
          sessionId: found.session.id,
          textTrackId: found.track.id,
          contentSourceId: found.contentSource.id,
          targetLanguage: found.session.target_language,
          segments: found.segments.map(toSegmentDto),
        },
      }
    }),

    importText: implementer.importText.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId

      const result = await importTextForUser(
        { userId, text: input.text, title: input.title, sourceUrl: input.sourceUrl ?? null },
        importTextDeps
      )
      if (!result.ok) {
        if (result.reason === 'empty') {
          throw errors.BAD_REQUEST({
            data: { errors: [{ message: 'No readable text found to import.' }] },
          })
        }
        throw errors.UNPROCESSABLE_ENTITY({ data: ingestPrefsErrorData(result) })
      }

      return {
        data: {
          sessionId: result.sessionId,
          contentSourceId: result.contentSourceId,
          textTrackId: result.textTrackId,
          segmentCount: result.segmentCount,
        },
      }
    }),

    remove: implementer.remove.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const session = await studySessionsRepository.findByIdForUser(input.sessionId, userId)
      if (!session) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Study session not found' }] },
        })
      }
      const ok = await studySessionsRepository.softDelete(input.sessionId, userId)
      if (!ok) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Failed to remove session' }] },
        })
      }
      return { data: { ok: true as const } }
    }),
  })

  return createOrpcExpressRouter(router, { contract: studySessionsContract })
}
