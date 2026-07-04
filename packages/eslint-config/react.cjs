const pluginLingui = require('eslint-plugin-lingui')
const reactYouMightNotNeedAnEffectPlugin = require('eslint-plugin-react-you-might-not-need-an-effect')
const base = require('./base.cjs')
const prettierOptions = require('./prettier-options.cjs')

// base + the React-package extras: the effect plugin (same zero-warning
// discipline as apps/web), lingui (shared packages carry user-facing copy),
// and tailwindcss class sorting in prettier.
//
// Deliberately NOT included (rationale in old-docs/packages-eslint-setup.md):
// - eslint-plugin-react-refresh: Fast Refresh is a consumer-bundler concern.
// - @tanstack/eslint-plugin-query: packages don't own query hooks.
module.exports = [
  pluginLingui.configs['flat/recommended'],
  reactYouMightNotNeedAnEffectPlugin.configs.recommended,
  ...base,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      'prettier/prettier': [
        'error',
        {
          ...prettierOptions,
          // resolved from this package so consumers don't each need the dep
          plugins: [require.resolve('prettier-plugin-tailwindcss')],
        },
      ],
    },
  },
]
