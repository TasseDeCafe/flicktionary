// Shared constants for the screenshot pipeline. Everything is overridable via
// env vars, but the defaults target the dev-tunnel stack, which must be
// running (pnpm dev) for any of the scripts to work.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const PACKAGE_DIR = path.resolve(__dirname, '../..')
export const REPO_ROOT = path.resolve(PACKAGE_DIR, '../..')

export const WEB_URL = process.env.SCREENSHOT_WEB_URL ?? 'https://web-sebastien.flicktionary.dev'
export const API_URL = process.env.SCREENSHOT_API_URL ?? 'https://backend-sebastien.flicktionary.dev'

// Local dev-tunnel Supabase; the secret is the standard local demo key
// (hardcoded in apps/backend/src/config/environment-config.ts for dev).
export const SUPABASE_URL = process.env.SCREENSHOT_SUPABASE_URL ?? 'http://127.0.0.1:34321'
export const SUPABASE_SERVICE_KEY = 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz'
export const DB_URL = process.env.SUPABASE_CONNECTION_STRING ?? 'postgresql://postgres:postgres@127.0.0.1:34322/postgres'

export const EXTENSION_PATH = path.join(REPO_ROOT, 'apps/extension/.output/chrome-mv3')
export const UBOLITE_DIR = path.join(PACKAGE_DIR, 'vendor/ubolite')
export const USER_DATA_DIR = path.join(PACKAGE_DIR, 'user-data')
export const OUT_DIR = path.join(PACKAGE_DIR, 'shots')
export const LANDING_ASSETS_DIR = path.join(REPO_ROOT, 'apps/landing/src/assets')

export const log = (...args) => console.log(new Date().toISOString().slice(11, 19), ...args)

export const ensureOutDir = () => fs.mkdirSync(OUT_DIR, { recursive: true })

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
