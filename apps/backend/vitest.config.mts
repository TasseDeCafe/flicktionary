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

  // Only integration tests touch the supabase-test stack; unit-only runs skip
  // the migration guard entirely.
  const globalSetup =
    process.env.VITEST_ENV === 'unit'
      ? []
      : ['./src/test/apply-test-db-migrations.global-setup.ts']

  return {
    resolve: {
      tsconfigPaths: true,
    },
    test: {
      include,
      // Applies pending migrations to the never-reset supabase-test stack so
      // the test schema can't drift from apps/backend/supabase/migrations.
      globalSetup,
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
