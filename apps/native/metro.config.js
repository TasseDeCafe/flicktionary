const { withUniwindConfig } = require('uniwind/metro')
const { getSentryExpoConfig } = require('@sentry/react-native/metro')

// Learn more https://docs.expo.io/guides/customizing-metro
// Since SDK 52+, Expo auto-configures Metro for monorepos
// Manual monorepo configuration has been removed in favor of auto-detection

const projectRoot = __dirname

const config = getSentryExpoConfig(projectRoot, {
  // See https://docs.sentry.io/platforms/react-native/session-replay/
  annotateReactComponents: true,
})

// Add Lingui Metro transformer support
const { transformer, resolver } = config
config.transformer = {
  ...transformer,
  babelTransformerPath: require.resolve('@lingui/metro-transformer/expo'),
}
config.resolver = {
  ...resolver,
  sourceExts: [...resolver.sourceExts, 'po', 'pot'],
}

module.exports = withUniwindConfig(config, {
  cssEntryFile: './src/global.css',
  polyfills: { rem: 14 },
})
