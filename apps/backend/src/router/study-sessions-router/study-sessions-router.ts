import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import { studySessionsContract } from '@flicktionary/api-client/orpc-contracts/study-sessions-contract'
import {
  DbStudySessionWithSource,
  StudySessionsRepositoryInterface,
} from '../../transport/database/study-sessions/study-sessions-repository'
import { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import { processSession, ProcessingDependencies } from '../../service/processing/process-session'
import { logWithSentry } from '../../transport/third-party/sentry/error-monitoring'
import { getEffectiveNativeLanguage } from '../../service/user-prefs/effective-native-language'

const readPosterUrl = (metadata: Record<string, unknown> | null): string | null => {
  const v = metadata?.posterUrl
  return typeof v === 'string' ? v : null
}

const readYear = (metadata: Record<string, unknown> | null): number | null => {
  const v = metadata?.year
  return typeof v === 'number' ? v : null
}

const toStudySessionDto = (row: DbStudySessionWithSource) => ({
  id: row.id,
  userId: row.user_id,
  contentSourceId: row.content_source_id,
  textTrackId: row.text_track_id,
  nativeLanguage: row.native_language,
  targetLanguage: row.target_language,
  cefrLevel: row.cefr_level,
  contextBlob: row.context_blob,
  status: row.status,
  processingWarnings: row.processing_warnings,
  createdAt: new Date(row.created_at).toISOString(),
  processedAt: row.processed_at ? new Date(row.processed_at).toISOString() : null,
  contentSourceTitle: row.content_source_title,
  contentSourceType: row.content_source_type,
  contentSourcePosterUrl: readPosterUrl(row.content_source_metadata),
  contentSourceYear: readYear(row.content_source_metadata),
})

export const StudySessionsRouter = (
  studySessionsRepository: StudySessionsRepositoryInterface,
  usersRepository: UsersRepositoryInterface,
  processingDependencies: ProcessingDependencies
): Router => {
  const implementer = implement(studySessionsContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

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
      const languagePrefs = await getEffectiveNativeLanguage({
        userId,
        targetLanguage: input.targetLanguage,
        snapshotNativeLanguage: input.nativeLanguage,
        usersRepository,
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
      // `processed`/`exported`/`failed` re-enter the orchestrator: it is idempotent
      // and only does the per-highlight pass for highlights that don't already
      // have a card. `processing` would race the in-flight run, so reject it.
      if (session.status === 'processing') {
        throw errors.CONFLICT({
          data: { errors: [{ message: 'Session is already processing' }] },
        })
      }
      const flipped = await studySessionsRepository.updateStatus(input.sessionId, userId, 'processing')
      if (!flipped) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Failed to start processing' }] },
        })
      }
      // Fire-and-forget: the pipeline is in-process and the route returns 202
      // immediately. The frontend polls getStatus to follow progress.
      void processSession(input.sessionId, userId, processingDependencies).catch((error) => {
        logWithSentry({ message: 'processSession crashed', params: { sessionId: input.sessionId, userId }, error })
      })
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
          status: session.status,
          processingWarnings: session.processing_warnings,
          processedAt: session.processed_at ? new Date(session.processed_at).toISOString() : null,
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

    remove: implementer.remove.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const session = await studySessionsRepository.findByIdForUser(input.sessionId, userId)
      if (!session) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Study session not found' }] },
        })
      }
      // Block while a pipeline run is in flight — yanking the row from under
      // the orchestrator would leave inconsistent state.
      if (session.status === 'processing') {
        throw errors.CONFLICT({
          data: { errors: [{ message: 'Session is processing — wait for it to finish before removing' }] },
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
