const tsParser = require('@typescript-eslint/parser')
const tsPlugin = require('@typescript-eslint/eslint-plugin')
const reactRefreshPlugin = require('eslint-plugin-react-refresh').default || require('eslint-plugin-react-refresh')
const tanstackPlugin = require('@tanstack/eslint-plugin-query')
const prettierPlugin = require('eslint-plugin-prettier')
const pluginLingui = require('eslint-plugin-lingui')
// todo eslint: deal with all the warnings and errors from those 2 plugins:
// const reactYouMightNotNeedAnEffectPlugin = require('eslint-plugin-react-you-might-not-need-an-effect')
// const reactPlugin = require('eslint-plugin-react');

module.exports = [
  ...tanstackPlugin.configs['flat/recommended'],
  pluginLingui.configs['flat/recommended'],
  // reactPlugin.configs.flat.recommended,
  // reactPlugin.configs.flat['jsx-runtime'],
  // reactYouMightNotNeedAnEffectPlugin.configs.recommended,
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/playground/**', '**/src/routeTree.gen.ts'],
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
]
