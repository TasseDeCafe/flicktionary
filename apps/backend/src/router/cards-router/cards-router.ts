import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { cardsContract } from '@flicktionary/api-client/orpc-contracts/cards-contract'
import { CardsRepositoryInterface, DbCard } from '../../transport/database/cards/cards-repository'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import { exportSession, ExportSessionDependencies } from '../../service/export/export-session'
import { exploreCardIfMissing, ExploreCardDependencies } from '../../service/exploration/explore-card-if-missing'
import { logCustomErrorMessageAndError } from '../../transport/third-party/sentry/error-monitoring'

const toCardDto = (row: DbCard) => ({
  id: row.id,
  studySessionId: row.study_session_id,
  highlightId: row.highlight_id,
  segmentId: row.segment_id,
  headword: row.headword,
  sense: row.sense ?? '',
  surfaceForm: row.surface_form,
  translation: row.translation,
  definition: row.definition,
  targetExample: row.target_example,
  nativeExample: row.native_example,
  explorationExtras: (row.exploration_extras ?? {}) as Record<string, unknown>,
  status: row.status,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
})

export const CardsRouter = (
  cardsRepository: CardsRepositoryInterface,
  studySessionsRepository: StudySessionsRepositoryInterface,
  exportDependencies: ExportSessionDependencies,
  exploreDependencies: ExploreCardDependencies
): Router => {
  const implementer = implement(cardsContract).$context<OrpcContext>()

  const router = implementer.router({
    listBySession: implementer.listBySession.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const session = await studySessionsRepository.findByIdForUser(input.sessionId, userId)
      if (!session) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Study session not found' }] },
        })
      }
      const cards = await cardsRepository.listBySessionId(input.sessionId, input.status)
      return { data: cards.map(toCardDto) }
    }),

    get: implementer.get.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const card = await cardsRepository.findByIdForUser(input.cardId, userId)
      if (!card) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Card not found' }] },
        })
      }
      return { data: toCardDto(card) }
    }),

    updateStatus: implementer.updateStatus.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const owned = await cardsRepository.findByIdForUser(input.cardId, userId)
      if (!owned) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Card not found' }] },
        })
      }
      const updated = await cardsRepository.updateStatus(input.cardId, input.status)
      if (!updated) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Failed to update card status' }] },
        })
      }
      return { data: toCardDto(updated) }
    }),

    updateFields: implementer.updateFields.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const owned = await cardsRepository.findByIdForUser(input.cardId, userId)
      if (!owned) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Card not found' }] },
        })
      }
      const updated = await cardsRepository.updateFields(input.cardId, {
        headword: input.patch.headword ?? null,
        sense: input.patch.sense ?? null,
        surfaceForm: input.patch.surfaceForm ?? null,
        translation: input.patch.translation ?? null,
        definition: input.patch.definition ?? null,
        targetExample: input.patch.targetExample ?? null,
        nativeExample: input.patch.nativeExample ?? null,
        extrasPatch: input.patch.extrasPatch ?? null,
      })
      if (!updated) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Failed to update card fields' }] },
        })
      }
      return { data: toCardDto(updated) }
    }),

    exportCsv: implementer.exportCsv.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const session = await studySessionsRepository.findByIdForUser(input.sessionId, userId)
      if (!session) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Study session not found' }] },
        })
      }

      try {
        const result = await exportSession(input.sessionId, userId, exportDependencies)
        return { data: result }
      } catch (e) {
        logCustomErrorMessageAndError(`cards.exportCsv, sessionId = ${input.sessionId}`, e)
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Failed to export session' }] },
        })
      }
    }),

    explore: implementer.explore.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const owned = await cardsRepository.findByIdForUser(input.cardId, userId)
      if (!owned) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Card not found' }] },
        })
      }
      const outcome = await exploreCardIfMissing(input.cardId, userId, exploreDependencies)
      if (outcome === 'failed') {
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Exploration failed' }] },
        })
      }
      const refreshed = await cardsRepository.findByIdForUser(input.cardId, userId)
      if (!refreshed) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Card disappeared after exploration' }] },
        })
      }
      return { data: toCardDto(refreshed) }
    }),
  })

  return createOrpcExpressRouter(router, { contract: cardsContract })
}
