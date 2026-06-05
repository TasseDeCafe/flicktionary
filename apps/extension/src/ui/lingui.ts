import { i18n } from '@lingui/core'
import { ENGLISH_LOCALE, FRENCH_LOCALE, i18nConfig, type Locale } from '@flicktionary/i18n/i18n-config'
import { detectBrowserLocale } from '@flicktionary/i18n/detect-browser-locale'
// Import the *compiled* catalogs (.ts), not the raw .po: WXT's Rolldown build
// drops @lingui/vite-plugin's .po transform output, so .po would bundle empty.
// Regenerate with `pnpm --filter @flicktionary/i18n lingui:compile`.
import { messages as enMessages } from '@flicktionary/i18n/locales/en/messages.ts'
import { messages as frMessages } from '@flicktionary/i18n/locales/fr/messages.ts'

// Lingui's `i18n` is a per-realm singleton. The extension renders React in
// several isolated contexts (popup, options, side panel, injected content-script
// UIs) — each is its own bundle/realm, so every entrypoint imports this module
// and calls setupLingui before mounting <I18nProvider>.
//
// The catalogs are loaded at module top level (not inside setupLingui) on
// purpose: @lingui/core is published `sideEffects: false`, so Rolldown prunes
// `i18n.load()` calls whose result is unused. As a top-level statement the load
// is retained as a module-init side effect (this is the same pattern as
// apps/web's lib/i18n/i18n.ts); moving it inside a function lets tree-shaking
// drop the catalog and silently bundle empty translations.
//
// Runs alongside the existing i18next setup during the migration: only strings
// already converted to Lingui macros resolve through here.
const catalogs: Record<Locale, typeof enMessages> = {
  [ENGLISH_LOCALE]: enMessages,
  [FRENCH_LOCALE]: frMessages,
}

i18n.load(catalogs)
i18n.activate(ENGLISH_LOCALE)

// 'system' (and any unknown value) resolves the browser locale at call time,
// so the UI follows the OS/browser language until the user picks an explicit one.
const toLocale = (language: string): Locale =>
  (i18nConfig.locales as readonly string[]).includes(language)
    ? (language as Locale)
    : detectBrowserLocale(typeof navigator !== 'undefined' ? navigator.language : undefined)

export const setupLingui = (language: string) => {
  const locale = toLocale(language)
  if (i18n.locale !== locale) {
    i18n.activate(locale)
  }
}

export { i18n }
