// Safety rails for `pnpm dev:scenario`, which wipes and rewrites a user's
// data: it must only ever touch the local dev-tunnel stack, and only the
// dedicated scenario account.

export const DEV_TUNNEL_NODE_ENV = 'development-tunnel'
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])
const DEV_TUNNEL_DB_PORT = '34322'
const DEV_TUNNEL_SUPABASE_PORT = '34321'

export const DEFAULT_SCENARIO_EMAIL = 'dev-scenario@flicktionary.app'
const SCENARIO_EMAIL_PREFIX = 'dev-scenario'

// Checked before any module that reads the app config is loaded: the config
// (and with it the database it points at) is picked from NODE_ENV.
export const assertDevTunnelNodeEnv = (nodeEnv: string | undefined): void => {
  if (nodeEnv !== DEV_TUNNEL_NODE_ENV) {
    throw new Error(
      `dev:scenario only runs against the local dev tunnel (NODE_ENV=${DEV_TUNNEL_NODE_ENV}), got NODE_ENV=${nodeEnv ?? '(unset)'}`
    )
  }
}

const isLocal = (rawUrl: string, port: string): boolean => {
  try {
    const url = new URL(rawUrl)
    return LOCAL_HOSTS.has(url.hostname) && url.port === port
  } catch {
    return false
  }
}

export const assertDevTunnelTarget = (params: { connectionString: string; supabaseUrl: string }): void => {
  if (!isLocal(params.connectionString, DEV_TUNNEL_DB_PORT)) {
    throw new Error(`dev:scenario refuses database ${maskPassword(params.connectionString)}: not the local dev tunnel`)
  }
  if (!isLocal(params.supabaseUrl, DEV_TUNNEL_SUPABASE_PORT)) {
    throw new Error(`dev:scenario refuses Supabase auth at ${params.supabaseUrl}: not the local dev tunnel`)
  }
}

// The reset deletes the account's sessions, vocabulary and practice history,
// so a typo'd --email must never land on a real dev account.
export const assertScenarioEmail = (email: string): void => {
  const localPart = email.trim().toLowerCase().split('@')[0] ?? ''
  if (!email.includes('@') || !localPart.startsWith(SCENARIO_EMAIL_PREFIX)) {
    throw new Error(`dev:scenario only seeds accounts whose email starts with "${SCENARIO_EMAIL_PREFIX}", got ${email}`)
  }
}

const maskPassword = (connectionString: string): string => connectionString.replace(/:[^:@/]+@/, ':****@')
