import { Router } from 'express'
import { implement } from '@orpc/server'
import { contactEmailContract } from '@template-app/api-client/orpc-contracts/contact-email-contract'
import { ResendApi } from '../../transport/third-party/resend/resend-api'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'

export const ContactEmailRouter = (resendApi: ResendApi): Router => {
  const implementer = implement(contactEmailContract).$context<OrpcContext>()

  const router = implementer.router({
    sendContactEmail: implementer.sendContactEmail.handler(async ({ input, errors }) => {
      const isEmailSentSuccessfully = await resendApi.sendContactEmail(input.username, input.email, input.message)

      if (!isEmailSentSuccessfully) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: {
            errors: [{ message: 'Failed to send email' }],
          },
        })
      }

      return {
        data: {
          message: 'Email sent successfully',
        },
      }
    }),
  })

  return createOrpcExpressRouter(router, { contract: contactEmailContract })
}
