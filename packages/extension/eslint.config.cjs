const tsParser = require('@typescript-eslint/parser')
const tsPlugin = require('@typescript-eslint/eslint-plugin')
const prettierPlugin = require('eslint-plugin-prettier')
const importPlugin = require('eslint-plugin-import')

module.exports = [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.wxt/**', '**/.output/**'],
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
      prettier: prettierPlugin,
      import: importPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // Pre-existing violations in the legacy asbplayer fork — surfaced as warnings
      // to clean up incrementally rather than blocking lint/check.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      'prettier/prettier': [
        'error',
        {
          trailingComma: 'es5',
          singleQuote: true,
          jsxSingleQuote: true,
          printWidth: 120,
          semi: false,
        },
      ],
    },
  },
]
