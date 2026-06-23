import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { cardsContract } from '@flicktionary/api-client/orpc-contracts/cards-contract'
import {
  CardsRepositoryInterface,
  DbCard,
  DbCardWithChunk,
  DbChunkSummary,
} from '../../transport/database/cards/cards-repository'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import { exploreCardIfMissing, ExploreCardDependencies } from '../../service/exploration/explore-card-if-missing'
import {
  setCardStatus,
  setCardStatusBatch,
  SetCardStatusDependencies,
  CardKeepBlockedError,
} from '../../service/cards/set-card-status'
import {
  createAdhocCard,
  CreateAdhocCardDependencies,
  AdhocCardCreationError,
} from '../../service/adhoc/create-adhoc-card'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import { toIsoString } from '../router-utils'

const toChunkDto = (chunk: DbChunkSummary) => ({
  id: chunk.id,
  userId: chunk.user_id,
  targetLanguage: chunk.target_language,
  headword: chunk.headword,
  sense: chunk.sense ?? '',
  translation: chunk.translation,
  definition: chunk.definition,
  targetExample: chunk.target_example,
  nativeExample: chunk.native_example,
  explorationExtras: (chunk.exploration_extras ?? {}) as Record<string, unknown>,
  grammar: (chunk.grammar ?? {}) as Record<string, unknown>,
  groundedAt: toIsoString(chunk.grounded_at),
  groundingPatch: chunk.grounding_patch ?? null,
  grammarUserEditedAt: toIsoString(chunk.grammar_user_edited_at),
  isProductionEnabled: chunk.is_production_enabled ?? false,
})

const toCardDto = (row: DbCardWithChunk) => ({
  id: row.id,
  studySessionId: row.study_session_id,
  highlightId: row.highlight_id,
  segmentId: row.segment_id,
  userLookupId: row.user_lookup_id,
  surfaceForm: row.surface_form,
  status: row.status,
  hasUnreadChat: row.has_unread_chat,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
  chunk: toChunkDto(row.chunk),
})

// updateStatus / updateStatusBatch return DbCard (no chunk join). Re-fetch by
// id to surface the chunk on the response, or accept a smaller shape and let
// the frontend reconcile from cache. Re-fetching is the simplest correct path.
const cardWithChunkOrError = async (
  cardsRepository: CardsRepositoryInterface,
  card: DbCard,
  userId: string
): Promise<DbCardWithChunk | null> => cardsRepository.findByIdForUser(card.id, userId)

export const CardsRouter = (
  cardsRepository: CardsRepositoryInterface,
  studySessionsRepository: StudySessionsRepositoryInterface,
  exploreDependencies: ExploreCardDependencies,
  setCardStatusDependencies: SetCardStatusDependencies,
  createAdhocCardDependencies: CreateAdhocCardDependencies
): Router => {
  const implementer = implement(cardsContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

  const router = implementer.router({
    listBySession: implementer.listBySession.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const session = await studySessionsRepository.findByIdForUser(input.sessionId, userId)
      if (!session) {
        throw errors.NOT_FOUND({
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
      let updated: DbCard | null
      try {
        updated = await setCardStatus(input.cardId, userId, input.status, setCardStatusDependencies)
      } catch (e) {
        if (e instanceof CardKeepBlockedError) {
          throw errors.CONFLICT({ data: { errors: [{ message: e.message }] } })
        }
        throw e
      }
      if (!updated) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Card not found' }] },
        })
      }
      const withChunk = await cardWithChunkOrError(cardsRepository, updated, userId)
      if (!withChunk) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Card disappeared after status update' }] } })
      }
      return { data: toCardDto(withChunk) }
    }),

    updateStatusBatch: implementer.updateStatusBatch.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const session = await studySessionsRepository.findByIdForUser(input.sessionId, userId)
      if (!session) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Study session not found' }] },
        })
      }
      const updated = await setCardStatusBatch(
        input.sessionId,
        input.cardIds,
        userId,
        input.status,
        setCardStatusDependencies
      )
      const withChunks = await Promise.all(updated.map((card) => cardWithChunkOrError(cardsRepository, card, userId)))
      return { data: withChunks.filter((c): c is DbCardWithChunk => c !== null).map(toCardDto) }
    }),

    updateFields: implementer.updateFields.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const owned = await cardsRepository.findByIdForUser(input.cardId, userId)
      if (!owned) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Card not found' }] },
        })
      }
      await cardsRepository.updateFields(input.cardId, {
        surfaceForm: input.patch.surfaceForm ?? null,
      })
      const refreshed = await cardsRepository.findByIdForUser(input.cardId, userId)
      if (!refreshed) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Card not found' }] } })
      }
      return { data: toCardDto(refreshed) }
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

    createAdhoc: implementer.createAdhoc.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      try {
        const result = await createAdhocCard({
          userId,
          targetLanguage: input.targetLanguage,
          headword: input.headword,
          context: input.context,
          studyIntent: input.studyIntent ?? null,
          deps: createAdhocCardDependencies,
        })
        return { data: result }
      } catch (e) {
        if (e instanceof AdhocCardCreationError) {
          if (e.code === 'cefr_not_set' || e.code === 'native_language_not_set') {
            throw errors.BAD_REQUEST({
              data: { errors: [{ message: e.message, code: e.code }] },
            })
          }
          throw errors.INTERNAL_SERVER_ERROR({
            data: { errors: [{ message: e.message, code: e.code }] },
          })
        }
        throw e
      }
    }),
  })

  return createOrpcExpressRouter(router, { contract: cardsContract })
}
