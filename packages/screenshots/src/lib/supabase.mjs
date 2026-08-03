import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_SERVICE_KEY } from './env.mjs'

export const adminClient = () =>
  createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

// Idempotent: creating an already-registered email is treated as success.
// The backend reads the email from the token's top-level claim, which GoTrue
// mints from auth.users.email — no user_metadata needed.
export const ensureUser = async (admin, email) => {
  const { error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  })
  if (error && error.code !== 'email_exists' && !/already.*registered/i.test(error.message)) {
    throw error
  }
}

export const mintTokenHash = async (admin, email) => {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw error
  return data.properties.hashed_token
}

// A real access token for API calls, without any browser or email round-trip.
export const mintAccessToken = async (admin, email) => {
  const tokenHash = await mintTokenHash(admin, email)
  const { data, error } = await admin.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash })
  if (error) throw error
  return data.session.access_token
}
