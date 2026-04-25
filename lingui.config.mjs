import { defineConfig } from '@lingui/cli'
import { formatter } from '@lingui/format-po'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  locales: ['en', 'es', 'fr', 'pl'],
  sourceLocale: 'en',
  catalogs: [
    {
      path: '<rootDir>/packages/i18n/locales/{locale}/messages',
      include: [
        '<rootDir>/apps/web/src',
        '<rootDir>/apps/native/src',
        '<rootDir>/packages/i18n/src',
        '<rootDir>/apps/landing-page/src',
      ],
      exclude: ['**/node_modules/**', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    },
  ],
  format: formatter(),
  compileNamespace: 'ts',
  rootDir: __dirname,
})
