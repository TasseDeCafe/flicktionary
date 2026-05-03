import { Router } from 'express'
import { implement } from '@orpc/server'
import { contactEmailContract } from '@flicktionary/api-client/orpc-contracts/contact-email-contract'
import { ResendApi } from '../../transport/third-party/resend/resend-api'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'

export const ContactEmailRouter = (resendApi: ResendApi): Router => {
  const implementer = implement(contactEmailContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

  const router = implementer.router({
    sendContactEmail: implementer.sendContactEmail.handler(async ({ input }) => {
      await resendApi.sendContactEmail(input.username, input.email, input.message)
      return {
        data: {
          message: 'Email sent successfully',
        },
      }
    }),
  })

  return createOrpcExpressRouter(router, { contract: contactEmailContract })
}
