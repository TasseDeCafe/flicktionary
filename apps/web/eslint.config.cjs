const tsParser = require('@typescript-eslint/parser')
const tsPlugin = require('@typescript-eslint/eslint-plugin')
const reactRefreshPlugin = require('eslint-plugin-react-refresh').default || require('eslint-plugin-react-refresh')
const tanstackPlugin = require('@tanstack/eslint-plugin-query')
const prettierPlugin = require('eslint-plugin-prettier')
const pluginLingui = require('eslint-plugin-lingui')
const reactYouMightNotNeedAnEffectPlugin = require('eslint-plugin-react-you-might-not-need-an-effect')
const eslintCommentsPlugin = require('@eslint-community/eslint-plugin-eslint-comments')
// todo eslint: deal with all the warnings and errors from this plugin:
// const reactPlugin = require('eslint-plugin-react');

module.exports = [
  ...tanstackPlugin.configs['flat/recommended'],
  pluginLingui.configs['flat/recommended'],
  // reactPlugin.configs.flat.recommended,
  // reactPlugin.configs.flat['jsx-runtime'],
  reactYouMightNotNeedAnEffectPlugin.configs.recommended,
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/playground/**', '**/routeTree.gen.ts'],
  },
  {
    // The effect-lint baseline is kept at zero (lint runs with --max-warnings 0):
    // every surviving effect the plugin flags carries an eslint-disable with a
    // `-- reason` explaining why it is genuinely needed. These two settings keep
    // that triage honest — suppressions without a reason and suppressions that
    // stopped matching anything both fail the lint.
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    plugins: {
      '@eslint-community/eslint-comments': eslintCommentsPlugin,
    },
    rules: {
      // eslint-enable is exempt: it only closes a block whose eslint-disable
      // already carries the reason.
      '@eslint-community/eslint-comments/require-description': ['error', { ignore: ['eslint-enable'] }],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    languageOptions: {
      globals: {
        browser: true,
        es2020: true,
        node: true,
      },
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-refresh': reactRefreshPlugin,
      prettier: prettierPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,

      // Ignore unavoidable callback/interface params and catch bindings, so the
      // rule only flags genuinely dead vars/imports.
      '@typescript-eslint/no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'react-refresh/only-export-components': [
        'warn',
        {
          allowConstantExport: true,
        },
      ],
      'prettier/prettier': [
        'error',
        {
          trailingComma: 'es5',
          singleQuote: true,
          jsxSingleQuote: true,
          printWidth: 120,
          semi: false,
          plugins: ['prettier-plugin-tailwindcss'],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'FunctionDeclaration',
          message: 'Use arrow functions with const instead of the "function" keyword.',
        },
      ],
    },
  },
  {
    // Vendored shadcn-style UI components and TanStack route files intrinsically
    // mix component and non-component exports (cva variants, hooks, `Route`).
    // Their HMR is handled fine, so scope off the Fast Refresh rule here.
    files: ['src/components/ui/**', 'src/app/routes/**'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
]
