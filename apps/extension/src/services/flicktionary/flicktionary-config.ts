// Endpoints / keys used by the Flicktionary side of the extension.
//
// Every value comes from a WXT_PUBLIC_* env var injected by Doppler at build
// time (WXT exposes WXT_PUBLIC_* to import.meta.env). The Doppler *config*
// selects the environment — there is intentionally no mode/tunnel branching:
//
//   local dev : doppler run --project extension --config dev_personal -- wxt
//   prod build: doppler run --project extension --config prd        -- wxt build
//
// There are deliberately NO hardcoded fallbacks. A missing var means a
// misconfigured build, so we fail loudly rather than silently ship a broken
// extension — which is exactly how pairing broke once: an unset Supabase URL
// fell back to `https://placeholder.supabase.co` and the background
// `verifyOtp` died with "Failed to fetch".

export interface FlicktionaryConfig {
  apiHost: string
  webUrl: string
  supabaseProjectUrl: string
  /** Anon (publishable) key — safe to ship in a public extension bundle. */
  supabasePublishableKey: string
  /**
   * SHA-256 hashes (lowercased, trimmed email) of admin/test-user emails —
   * gates the popup's Admin tab. Same scheme as the web app's
   * VITE_HASHED_EMAILS_OF_TEST_USERS; the backend holds the plaintext list
   * (EMAILS_OF_TEST_USERS), only hashes ship in public bundles.
   */
  hashedEmailsOfTestUsers: string[]
}

const requireEnv = (name: string, value: string | undefined): string => {
  if (!value) {
    throw new Error(
      `[flicktionary-config] Missing required env var ${name}. ` +
        `Run under Doppler, e.g. \`doppler run --project extension --config dev_personal -- wxt\` (dev) ` +
        `or \`doppler run --project extension --config prd -- wxt build\` (prod).`
    )
  }
  return value
}

export const getFlicktionaryConfig = (): FlicktionaryConfig => ({
  apiHost: requireEnv('WXT_PUBLIC_API_HOST', import.meta.env.WXT_PUBLIC_API_HOST),
  webUrl: requireEnv('WXT_PUBLIC_WEB_URL', import.meta.env.WXT_PUBLIC_WEB_URL),
  supabaseProjectUrl: requireEnv('WXT_PUBLIC_SUPABASE_PROJECT_URL', import.meta.env.WXT_PUBLIC_SUPABASE_PROJECT_URL),
  supabasePublishableKey: requireEnv(
    'WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    import.meta.env.WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ),
  // Deliberately NOT requireEnv (the one exception to the fail-loudly rule
  // above): an empty admin list is a valid state — it only hides the popup's
  // Admin tab — and must not brick a build whose Doppler config lacks the var.
  hashedEmailsOfTestUsers: (import.meta.env.WXT_PUBLIC_HASHED_EMAILS_OF_TEST_USERS ?? '')
    .split(',')
    .map((hash: string) => hash.trim())
    .filter((hash: string) => hash.length > 0),
})
