import { defineConfig } from 'vitest/config'

export default defineConfig(() => {
  const testPatterns = {
    unit: ['./src/**/*.unit.test.*'],
    integration: ['./src/**/*.integration.test.*'],
  }

  const getTestPatterns = (testType: string | undefined) => {
    switch (testType) {
      case 'unit':
        return testPatterns.unit
      case 'integration':
        return testPatterns.integration
      default:
        return ['./src/**/*.test.*']
    }
  }

  const include = getTestPatterns(process.env.VITEST_ENV)

  return {
    resolve: {
      tsconfigPaths: true,
    },
    test: {
      include,
      // Binds supertest's throwaway servers to 127.0.0.1 so ephemeral-port
      // collisions with other local apps can't hijack requests — see the file.
      // Harmless for unit tests, so it's loaded unconditionally.
      setupFiles: ['./src/test/bind-loopback.setup.ts'],
      pool: 'threads',
      // Test files run in parallel against the shared supabase-test stack:
      // every test creates its own unique user, so files can't interfere. The
      // worker cap keeps the combined postgres.js pools (one per worker)
      // within the local Postgres connection limit.
      maxWorkers: 4,
      testTimeout: 10000,
    },
  }
})
