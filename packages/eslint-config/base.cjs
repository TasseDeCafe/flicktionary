const tsParser = require('@typescript-eslint/parser')
const tsPlugin = require('@typescript-eslint/eslint-plugin')
const prettierPlugin = require('eslint-plugin-prettier')
const eslintCommentsPlugin = require('@eslint-community/eslint-plugin-eslint-comments')
const prettierOptions = require('./prettier-options.cjs')

// Flat-config preset for plain-TS workspace packages. React packages spread
// `./react` instead, which layers the React-specific plugins on top of this.
module.exports = [
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
  {
    // The lint baseline is kept at zero (lint runs with --max-warnings 0):
    // every surviving suppression carries an eslint-disable with a `-- reason`
    // explaining why it is genuinely needed. These two settings keep that
    // triage honest — suppressions without a reason and suppressions that
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
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      prettier: prettierPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,

      // Ignore unavoidable callback/interface params and catch bindings, so the
      // rule only flags genuinely dead vars/imports.
      '@typescript-eslint/no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'prettier/prettier': ['error', prettierOptions],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'FunctionDeclaration',
          message: 'Use arrow functions with const instead of the "function" keyword.',
        },
      ],
    },
  },
]
