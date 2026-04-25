import { sentryVitePlugin } from '@sentry/vite-plugin'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { lingui } from '@lingui/vite-plugin'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [
    tanstackRouter({
      routesDirectory: './src/app/routes',
      generatedRouteTree: './src/app/routeTree.gen.ts',
    }),
    react(),
    tailwindcss(),
    // This could be optimized by only running babel on files whose source code contains a lingui macro import
    // see: https://github.com/lingui/js-lingui/issues/2477#issuecomment-4068015629
    babel({
      plugins: ['babel-plugin-react-compiler', '@lingui/babel-plugin-lingui-macro'],
    }),
    lingui(),
    sentryVitePlugin({
      org: 'template-organization',
      project: 'web',
      authToken: process.env.SENTRY_AUTH_TOKEN,
      release: {
        name: process.env.RAILWAY_GIT_COMMIT_SHA,
      },
      sourcemaps: {
        filesToDeleteAfterUpload: ['./**/*.map', '.*/**/public/**/*.map', './dist/**/client/**/*.map'],
      },
    }),
  ],
  build: {
    sourcemap: true,
  },
  resolve: {
    tsconfigPaths: true,
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    dedupe: ['react', 'react-dom'],
    alias: {
      react: path.resolve('./node_modules/react'),
      'react-dom': path.resolve('./node_modules/react-dom'),
    },
  },
  server: {
    // Necessary to make sure that app-monorepo-template.dev is allowed
    // when false, only localhost is allowed
    allowedHosts: true,
  },
})
