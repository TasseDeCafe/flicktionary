import { z } from 'zod'

const emailSchema = z.email()

export const parseEmails = (emailsInSingleString: string): { validEmails: string[]; invalidEmails: string[] } => {
  const emails = emailsInSingleString
    .split(',')
    .map((email) => email.trim())
    .filter((email) => !!email)
  const validEmails: string[] = []
  const invalidEmails: string[] = []

  emails.forEach((email) => {
    const result = emailSchema.safeParse(email)
    if (result.success) {
      validEmails.push(email)
    } else {
      invalidEmails.push(email)
    }
  })

  return { validEmails, invalidEmails }
}
