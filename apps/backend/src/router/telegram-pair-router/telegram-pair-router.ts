import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import { telegramPairContract } from '@flicktionary/api-client/orpc-contracts/telegram-pair-contract'
import { logWithSentry } from '../../transport/third-party/sentry/error-monitoring'
import { resumePendingImportForChat, TelegramBotDependencies } from '../../service/telegram-bot/handle-telegram-update'

export const TelegramPairRouter = (deps: TelegramBotDependencies): Router => {
  const implementer = implement(telegramPairContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

  const router = implementer.router({
    claim: implementer.claim.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId

      const result = await deps.telegramPairNoncesRepository.claimAndPair(input.nonce, userId)
      if (!result.ok) {
        if (result.reason === 'user-missing') {
          // The public.users row is created lazily by the web app's
          // UserSetupGate; a fresh signup can hit claim before it lands. The
          // claim rolled back, so the page can retry with the same nonce.
          throw errors.CONFLICT({
            data: { errors: [{ message: 'Account not fully set up yet — retry in a moment' }] },
          })
        }
        throw errors.BAD_REQUEST({
          data: { errors: [{ message: 'Pairing link already used or expired' }] },
        })
      }

      void deps.telegramApi
        .sendMessage({
          chatId: result.chatId,
          text: 'Connected! I will reply with a reading link whenever you send me a text.',
        })
        .catch((error) => {
          logWithSentry({
            message: 'Telegram pairing confirmation message failed',
            params: { userId },
            error,
          })
        })

      return { data: { paired: true as const } }
    }),

    completePending: implementer.completePending.handler(async ({ context }) => {
      const userId = context.res.locals.userId

      const chatId = await deps.usersRepository.getTelegramChatId(userId)
      if (!chatId) return { data: { accepted: false } }

      // Fire-and-forget: the resume runs a language-detection LLM call and
      // replies in Telegram; the web page only needs to know it was kicked off.
      void resumePendingImportForChat(chatId, deps).catch((error) => {
        logWithSentry({
          message: 'Telegram pending import resume failed',
          params: { userId },
          error,
        })
      })

      return { data: { accepted: true } }
    }),
  })

  return createOrpcExpressRouter(router, { contract: telegramPairContract })
}
