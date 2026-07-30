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
      plugins: ['@lingui/babel-plugin-lingui-macro', 'babel-plugin-react-compiler'],
    }),
    lingui(),
  ],
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
    // Necessary to make sure that flicktionary.app is allowed
    // when false, only localhost is allowed
    allowedHosts: true,
  },
})
