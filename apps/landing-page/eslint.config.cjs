const tsPlugin = require('@typescript-eslint/eslint-plugin')
const prettierPlugin = require('eslint-plugin-prettier')
const nextPlugin = require('@next/eslint-plugin-next')
const tsParser = require('@typescript-eslint/parser')
const pluginLingui = require('eslint-plugin-lingui')

module.exports = [
  pluginLingui.configs['flat/recommended'],
  {
    plugins: {
      '@next/next': nextPlugin,
    },
    rules: { ...nextPlugin.configs.recommended.rules },
  },
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.next/**', '**/public/**', 'next-env.d.ts'],
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
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
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
]
