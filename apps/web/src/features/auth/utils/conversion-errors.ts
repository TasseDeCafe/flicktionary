import { AuthError } from '@supabase/supabase-js'

// Guest → account conversion never merges accounts: when the chosen email or
// Google identity already belongs to another user, Supabase refuses and the UI
// sends the guest to log in to that account instead.
export type EmailConversionErrorKind = 'email_exists' | 'rate_limited' | 'unknown'

export const classifyEmailConversionError = (error: unknown): EmailConversionErrorKind => {
  if (!(error instanceof AuthError)) return 'unknown'
  if (error.code === 'email_exists') return 'email_exists'
  if (error.code === 'over_email_send_rate_limit' || error.status === 429) return 'rate_limited'
  return 'unknown'
}

export type OAuthLinkError = 'identity_exists' | 'oauth_failed'

// linkIdentity errors come back on the redirect URL rather than as a thrown
// error — GoTrue appends them to the query (and, on the implicit flow, the
// fragment), so both are checked.
export const parseOAuthLinkError = (search: string, hash: string): OAuthLinkError | null => {
  const searchParams = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const hashParams = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const readParam = (key: string) => hashParams.get(key) ?? searchParams.get(key)

  const error = readParam('error')
  const errorCode = readParam('error_code')
  const errorDescription = readParam('error_description')
  if (!error && !errorCode && !errorDescription) return null
  if (errorCode === 'identity_already_exists' || /already linked/i.test(errorDescription ?? '')) {
    return 'identity_exists'
  }
  return 'oauth_failed'
}
