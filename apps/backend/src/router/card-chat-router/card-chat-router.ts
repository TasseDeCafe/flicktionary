import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import { cardChatContract } from '@flicktionary/api-client/orpc-contracts/card-chat-contract'
import {
  CardChatMessagesRepositoryInterface,
  DbCardChatMessage,
} from '../../transport/database/card-chat-messages/card-chat-messages-repository'
import { CardsRepositoryInterface } from '../../transport/database/cards/cards-repository'
import { runCardChat, RunCardChatDependencies } from '../../service/chat/run-card-chat'

const toChatMessageDto = (row: DbCardChatMessage) => ({
  id: row.id,
  cardId: row.card_id,
  role: row.role,
  content: row.content,
  createdAt: new Date(row.created_at).toISOString(),
})

export const CardChatRouter = (
  cardChatMessagesRepository: CardChatMessagesRepositoryInterface,
  cardsRepository: CardsRepositoryInterface,
  chatDependencies: RunCardChatDependencies
): Router => {
  const implementer = implement(cardChatContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

  const router = implementer.router({
    listForCard: implementer.listForCard.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const owned = await cardsRepository.findByIdForUser(input.cardId, userId)
      if (!owned) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Card not found' }] },
        })
      }
      const messages = await cardChatMessagesRepository.listByCardId(input.cardId)
      return { data: messages.map(toChatMessageDto) }
    }),

    sendMessage: implementer.sendMessage.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const owned = await cardsRepository.findByIdForUser(input.cardId, userId)
      if (!owned) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Card not found' }] },
        })
      }
      const { userMessage, assistantMessage } = await runCardChat(
        { cardId: input.cardId, userId, content: input.content },
        chatDependencies
      )
      return {
        data: {
          userMessage: toChatMessageDto(userMessage),
          assistantMessage: toChatMessageDto(assistantMessage),
        },
      }
    }),

    markRead: implementer.markRead.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const owned = await cardsRepository.findByIdForUser(input.cardId, userId)
      if (!owned) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Card not found' }] },
        })
      }
      await cardChatMessagesRepository.upsertReadState(input.cardId)
      return { data: { ok: true } }
    }),
  })

  return createOrpcExpressRouter(router, { contract: cardChatContract })
}
