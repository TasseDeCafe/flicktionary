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

// Turnstile sitekey resolution for the captcha escalation flag
// (CAPTCHA_ENABLED / TURNSTILE_SITE_KEY in Doppler). Enabled without a sitekey
// throws instead of degrading to null: depending on the Supabase dashboard
// toggle that state is either a guest-signup outage or protection that looks
// on but isn't, and the flag is only ever flipped deliberately during an
// incident — a loud deploy failure is the cheapest place to catch it.
export const resolveCaptchaSiteKey = (env: {
  CAPTCHA_ENABLED?: string
  TURNSTILE_SITE_KEY?: string
}): string | null => {
  if (env.CAPTCHA_ENABLED !== 'true') return null
  if (!env.TURNSTILE_SITE_KEY) {
    throw Error('CAPTCHA_ENABLED is true but TURNSTILE_SITE_KEY is empty — set the sitekey or disable the flag')
  }
  return env.TURNSTILE_SITE_KEY
}
