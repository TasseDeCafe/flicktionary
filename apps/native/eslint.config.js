// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config')
const expoConfig = require('eslint-config-expo/flat')
const prettierPlugin = require('eslint-plugin-prettier')
const tanstackPlugin = require('@tanstack/eslint-plugin-query')
const reactCompiler = require('eslint-plugin-react-compiler')
const pluginLingui = require('eslint-plugin-lingui')

module.exports = defineConfig([
  ...tanstackPlugin.configs['flat/recommended'],
  pluginLingui.configs['flat/recommended'],
  expoConfig,
  reactCompiler.configs.recommended,
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/playground]'],
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
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
      // todo eslint
      // add the below rule to make it more similar to frontend and landing
      // 'no-restricted-syntax': [
      //   'error',
      //   {
      //     selector: 'FunctionDeclaration',
      //     message: 'Use arrow functions with const instead of the "function" keyword.',
      //   },
      // ],
    },
  },
  {
    files: ['src/app/(requires-auth)/choose-plan/index.tsx', 'src/hooks/use-onboarding-navigation-cleanup.ts'],
    rules: {
      'react-compiler/react-compiler': 'off',
    },
  },
])
