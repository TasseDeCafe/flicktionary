import { withSentryConfig } from '@sentry/nextjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)
const linguiLoaderPath = require.resolve('@lingui/loader')

const nextConfig = {
  allowedDevOrigins: ['http://localhost:3000', '*.app-monorepo-template.dev'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'www.app-monorepo-template.com',
      },
    ],
  },
  // https://github.com/lingui/js-lingui/blob/main/examples/nextjs-swc/next.config.ts
  turbopack: {
    root: path.join(__dirname, '..', '..'),
    rules: {
      '*.po': {
        loaders: ['@lingui/loader'],
        as: '*.js',
      },
    },
  },
  experimental: {
    swcPlugins: [['@lingui/swc-plugin', {}]],
  },
  reactCompiler: true,
  // https://github.com/lingui/js-lingui/blob/main/examples/nextjs-swc/next.config.ts
  webpack: (config) => {
    config.module.rules.push({
      test: /\.po$/,
      use: [
        {
          loader: linguiLoaderPath,
        },
      ],
    })
    return config
  },
}

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "template-organization",

  project: "landing-page",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  // Automatically tree-shake Sentry logger statements to reduce bundle size
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,
  },
});