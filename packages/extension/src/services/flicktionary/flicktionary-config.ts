// Endpoints / keys used by the Flicktionary side of the extension.
//
// Mode selection mirrors the web app's pattern (apps/web/src/config/
// environment-utils.ts): `import.meta.env.MODE` distinguishes production from
// development, and `VITE_IS_FOR_TUNNEL=true` flips development into
// development-tunnel — where URLs are read from VITE_* env vars supplied via
// Doppler. WXT only exposes WXT_PUBLIC_* by default; wxt.config.ts adds
// `VITE_` to vite's envPrefix so the existing Doppler config works unchanged.

const mode = import.meta.env.MODE
const isProduction = mode === 'production'
const isDevelopmentTunnel = !isProduction && import.meta.env.VITE_IS_FOR_TUNNEL === 'true'

export interface FlicktionaryConfig {
  apiHost: string
  webUrl: string
  supabaseProjectUrl: string
  /** Anon (publishable) key — safe to ship in a public extension bundle. */
  supabasePublishableKey: string
}

const productionConfig: FlicktionaryConfig = {
  apiHost: 'https://api.flicktionary.app',
  webUrl: 'https://app.flicktionary.app',
  // Real values are wired in from env at packaging time (see scripts/package
  // step / CI). The fallbacks here are placeholders to keep dev builds
  // resolvable; we'll replace them with the actual prod project credentials
  // before submitting to the store.
  supabaseProjectUrl: import.meta.env.WXT_PUBLIC_SUPABASE_PROJECT_URL ?? 'https://placeholder.supabase.co',
  supabasePublishableKey: import.meta.env.WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? 'placeholder-anon-key',
}

const developmentConfig: FlicktionaryConfig = {
  apiHost: 'http://localhost:4003',
  webUrl: 'http://localhost:5174',
  supabaseProjectUrl: 'http://127.0.0.1:54321',
  // Local Supabase anon key, stable across resets.
  supabasePublishableKey: 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
}

// Same shape, but URLs are pulled from VITE_* env vars (Doppler dev_personal)
// to match each developer's personal *.flicktionary.dev tunnel. The supabase
// instance is the local dev-tunnel one (port 34321).
const developmentTunnelConfig: FlicktionaryConfig = {
  ...developmentConfig,
  apiHost: import.meta.env.VITE_API_HOST ?? developmentConfig.apiHost,
  webUrl: import.meta.env.VITE_WEB_URL ?? developmentConfig.webUrl,
  supabaseProjectUrl: import.meta.env.VITE_SUPABASE_PROJECT_URL ?? developmentConfig.supabaseProjectUrl,
  supabasePublishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? developmentConfig.supabasePublishableKey,
}

export const getFlicktionaryConfig = (): FlicktionaryConfig => {
  if (isProduction) return productionConfig
  if (isDevelopmentTunnel) return developmentTunnelConfig
  return developmentConfig
}
