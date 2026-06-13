// https://docs.expo.dev/guides/using-eslint/
const path = require('node:path')
const { defineConfig } = require('eslint/config')
const { includeIgnoreFile } = require('@eslint/compat')
const expoConfig = require('eslint-config-expo/flat')

// eslint runs with the workspace dir as cwd, so `.gitignore` resolves to this
// package's own ignore file without relying on __dirname (which the expo flat
// config doesn't register as a global when it lints this config file).
const gitignorePath = path.resolve('.gitignore')
const prettierPlugin = require('eslint-plugin-prettier')
const tanstackPlugin = require('@tanstack/eslint-plugin-query')
const reactCompiler = require('eslint-plugin-react-compiler')
const pluginLingui = require('eslint-plugin-lingui')

module.exports = defineConfig([
  // Skip everything git ignores (Expo's generated expo-env.d.ts, .expo/,
  // web-build/, android/, ios/, *.tsbuildinfo, …) — these are never
  // hand-edited, so linting them is pointless and read-only lint would fail on
  // their formatting with nothing to commit a fix to.
  includeIgnoreFile(gitignorePath),
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
