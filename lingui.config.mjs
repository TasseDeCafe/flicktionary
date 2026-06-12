import { defineConfig } from '@lingui/cli'
import { formatter } from '@lingui/format-po'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  locales: ['en', /* 'es', */ 'fr' /* , 'pl' */],
  sourceLocale: 'en',
  catalogs: [
    {
      path: '<rootDir>/packages/i18n/locales/{locale}/messages',
      include: [
        '<rootDir>/apps/web/src',
        '<rootDir>/apps/native/src',
        '<rootDir>/packages/i18n/src',
        '<rootDir>/packages/ui/src',
        '<rootDir>/apps/extension/src',
        '<rootDir>/apps/extension/common',
      ],
      exclude: ['**/node_modules/**', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    },
  ],
  // lineNumbers: false keeps the `#:` file-path origins but drops the `:NNN`
  // suffixes, so unrelated line shifts in source files don't churn the catalogs.
  format: formatter({ lineNumbers: false }),
  compileNamespace: 'ts',
  rootDir: __dirname,
})
