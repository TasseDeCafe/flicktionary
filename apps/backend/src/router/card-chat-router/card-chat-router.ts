import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { cardChatContract } from '@flicktionary/api-client/orpc-contracts/card-chat-contract'
import {
  CardChatMessagesRepositoryInterface,
  DbCardChatMessage,
} from '../../transport/database/card-chat-messages/card-chat-messages-repository'
import { CardsRepositoryInterface } from '../../transport/database/cards/cards-repository'
import { runCardChat, RunCardChatDependencies } from '../../service/chat/run-card-chat'
import { logCustomErrorMessageAndError } from '../../transport/third-party/sentry/error-monitoring'

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
  const implementer = implement(cardChatContract).$context<OrpcContext>()

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
      try {
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
      } catch (e) {
        logCustomErrorMessageAndError(`cardChat.sendMessage, cardId = ${input.cardId}`, e)
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Failed to send chat message' }] },
        })
      }
    }),
  })

  return createOrpcExpressRouter(router, { contract: cardChatContract })
}
