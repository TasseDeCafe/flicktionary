import { oc } from '@orpc/contract'
import { z } from 'zod'

export const CONTACT_EMAIL_PATH = '/send-contact-email' as const

export const formSchema = z.object({
  username: z.string().optional(),
  email: z.email({
    message: 'Please enter a valid email address.',
  }),
  message: z
    .string()
    .max(1000, {
      message: 'The message must be less than 1000 characters.',
    })
    .min(4, {
      message: 'Your message is too short, it must be at least 4 characters.',
    }),
})

export const contactEmailContract = {
  sendContactEmail: oc
    .route({
      method: 'POST',
      path: CONTACT_EMAIL_PATH,
      successStatus: 200,
    })
    .input(formSchema)
    .errors({
      INTERNAL_SERVER_ERROR: {
        status: 500,
        data: z.object({
          errors: z.array(
            z.object({
              message: z.string(),
            })
          ),
        }),
      },
    })
    .output(
      z.object({
        data: z.object({
          message: z.string(),
        }),
      })
    ),
} as const
