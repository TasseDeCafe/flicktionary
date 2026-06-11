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
import { HighlightsRepositoryInterface } from '../../transport/database/highlights/highlights-repository'
import { logWithSentry } from '../../transport/third-party/sentry/error-monitoring'
import { getLanguageMode } from '../../service/user-prefs/language-mode'
import { languageDetectionPass } from '../../transport/third-party/anthropic/passes/language-detection-pass'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { parsePastedText } from '../../utils/text-paste-parser'
import { createHash } from 'crypto'

// languageDetectionPass reads the first ~1k chars; concatenating a few dozen
// segments is more than enough to identify the language while keeping the
// prompt small.
const DETECTION_SAMPLE_CHARS = 1_000

const buildDetectionSample = (segments: ReadonlyArray<{ text: string }>): string => {
  const parts: string[] = []
  let length = 0
  for (const segment of segments) {
    const text = segment.text.trim()
    if (text.length === 0) continue
    parts.push(text)
    length += text.length + 1
    if (length >= DETECTION_SAMPLE_CHARS) break
  }
  return parts.join('\n')
}

const readPosterUrl = (metadata: Record<string, unknown> | null): string | null => {
  const v = metadata?.posterUrl
  return typeof v === 'string' ? v : null
}

const readYear = (metadata: Record<string, unknown> | null): number | null => {
  const v = metadata?.year
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
  createdAt: new Date(row.created_at).toISOString(),
  contentSourceTitle: row.content_source_title,
  contentSourceType: row.content_source_type,
  contentSourcePosterUrl: readPosterUrl(row.content_source_metadata),
  contentSourceYear: readYear(row.content_source_metadata),
})

export const StudySessionsRouter = (
  studySessionsRepository: StudySessionsRepositoryInterface,
  usersRepository: UsersRepositoryInterface,
  targetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface,
  processingJobsRepository: ProcessingJobsRepositoryInterface,
  highlightsRepository: HighlightsRepositoryInterface
): Router => {
  const implementer = implement(studySessionsContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

  // Shared front half of both extension ingestion flows (YouTube + streaming):
  // detect the subtitle language and resolve the user's native + CEFR prefs for
  // it. Returns a discriminated result so each handler can map a failure to its
  // own typed `errors.*` (the language detected here is the single source of
  // truth — content language AND session target language).
  type ExtensionIngestPrefs =
    | { ok: true; detectedLanguage: string; nativeLanguage: string; cefrLevel: string }
    | { ok: false; reason: 'unsupported' }
    | { ok: false; reason: 'missing-cefr'; targetLanguage: string }

  const resolveExtensionIngestPrefs = async (
    userId: string,
    // Only the segment text is read (for language detection); subtitle and text
    // imports both satisfy this shape.
    segments: ReadonlyArray<{ text: string }>
  ): Promise<ExtensionIngestPrefs> => {
    const detectedLanguage = await languageDetectionPass(buildDetectionSample(segments))
    if (!detectedLanguage) return { ok: false, reason: 'unsupported' }

    const [nativeLanguage, prefs] = await Promise.all([
      usersRepository.getNativeLanguage(userId),
      targetLanguagePrefsRepository.findForLanguage(userId, detectedLanguage),
    ])
    // native + CEFR live in user_prefs (set during onboarding), keyed by the
    // language being studied. Without both we can't shape an enrichment-ready
    // session — the extension prompts the user to set their level.
    if (!nativeLanguage || !prefs?.cefr_level) {
      return { ok: false, reason: 'missing-cefr', targetLanguage: detectedLanguage }
    }
    return { ok: true, detectedLanguage, nativeLanguage, cefrLevel: prefs.cefr_level }
  }

  // Build the UNPROCESSABLE_ENTITY error body for a failed prefs resolution.
  // The handler throws its own typed `errors.UNPROCESSABLE_ENTITY({ data })` —
  // this just shares the code/message shaping between the two ingest flows.
  const ingestPrefsErrorData = (
    prefs: { reason: 'unsupported' } | { reason: 'missing-cefr'; targetLanguage: string }
  ) => {
    if (prefs.reason === 'unsupported') {
      return {
        errors: [
          { code: 'UNSUPPORTED_LANGUAGE', message: 'This content is not in a language Flicktionary supports yet.' },
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
      // backwards-compatible no-op that lets old clients jump to triage without
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
      // answer is not a missing card, so it must not show up as a triage straggler.
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

      return {
        data: {
          sessionId: session.id,
          textTrackId: track.id,
          contentSourceId: contentSource.id,
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

        return {
          data: {
            sessionId: session.id,
            textTrackId: track.id,
            contentSourceId: contentSource.id,
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
          segments: found.segments.map(toSegmentDto),
        },
      }
    }),

    importText: implementer.importText.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId

      // One segment per non-empty line, same parser the web paste wizard uses, so
      // a selection imported here reads identically to one pasted in the app.
      const parsed = parsePastedText(input.text)
      if (parsed.length === 0) {
        throw errors.BAD_REQUEST({
          data: { errors: [{ message: 'No readable text found to import.' }] },
        })
      }

      const prefs = await resolveExtensionIngestPrefs(userId, parsed)
      if (!prefs.ok) {
        throw errors.UNPROCESSABLE_ENTITY({ data: ingestPrefsErrorData(prefs) })
      }
      const { detectedLanguage, nativeLanguage, cefrLevel } = prefs

      // Natural key for idempotent re-import: hash of the parsed segment text.
      // Same normalization as the web paste dedup so identical bodies collapse.
      const contentHash = createHash('sha256')
        .update(parsed.map((s) => `|${s.text}`).join('\n'))
        .digest('hex')

      const sourceUrl = input.sourceUrl ?? null
      const { session, track, contentSource, segments } = await studySessionsRepository.getOrCreateForImportedText({
        userId,
        type: sourceUrl ? 'article' : 'text',
        title: input.title,
        sourceUrl,
        contentHash,
        language: detectedLanguage,
        segments: parsed,
        nativeLanguage,
        targetLanguage: detectedLanguage,
        cefrLevel,
      })

      void usersRepository.setLastTargetLanguage(userId, detectedLanguage).catch((error) => {
        logWithSentry({
          message: 'setLastTargetLanguage failed (text import)',
          params: { userId, targetLanguage: detectedLanguage },
          error,
        })
      })

      return {
        data: {
          sessionId: session.id,
          contentSourceId: contentSource.id,
          textTrackId: track.id,
          segmentCount: segments.length,
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
