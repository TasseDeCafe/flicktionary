// The repo prettier shape (mirrors apps/web). Shared between base.cjs and
// react.cjs, which re-declares the prettier rule to add the tailwindcss plugin.
module.exports = {
  trailingComma: 'es5',
  singleQuote: true,
  jsxSingleQuote: true,
  printWidth: 120,
  semi: false,
}
