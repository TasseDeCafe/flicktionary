// Shared connection resolution for the standalone tsx scripts in this folder.
// The scripts deliberately avoid booting the app's config layer, so the
// dev-tunnel connection string is hardcoded here (it is also hardcoded in
// apps/backend/src/config/environment-config.ts).
export const DEFAULT_LOCAL_DEV_CONNECTION = 'postgresql://postgres:postgres@127.0.0.1:34322/postgres'

// Falling back to the local dev tunnel keeps bare local runs zero-config, but
// under `doppler run` a missing SUPABASE_CONNECTION_STRING means Doppler
// resolved the wrong project/config (e.g. a prod load started from the repo
// root instead of apps/backend). A silent fallback would point a "prod"
// command at the local DB, so fail loud instead.
export const resolveConnectionString = (): string => {
  const envValue = process.env.SUPABASE_CONNECTION_STRING ?? ''
  if (envValue.startsWith('postgresql://')) return envValue
  const dopplerConfig = process.env.DOPPLER_CONFIG
  if (dopplerConfig) {
    const problem = envValue ? 'is not a postgresql:// URL' : 'is missing'
    throw new Error(
      `Running under Doppler config "${dopplerConfig}" but SUPABASE_CONNECTION_STRING ${problem}. ` +
        'Doppler probably resolved the wrong project — run the command from apps/backend, ' +
        'or drop `doppler run` to target the local dev tunnel.'
    )
  }
  return DEFAULT_LOCAL_DEV_CONNECTION
}

export const maskConnectionString = (connectionString: string): string => {
  return connectionString.replace(/:[^:@]+@/, ':****@')
}
