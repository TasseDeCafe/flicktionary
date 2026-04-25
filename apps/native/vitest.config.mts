import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

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
    plugins: [tsconfigPaths()],
    test: {
      include,
      pool: 'threads',
      maxWorkers: 1,
      // this flag is explained here: https://vitest.dev/config/#fileparallelism
      // this is an attempt to solve the problem with flaky tests in this ticket
      // https://www.notion.so/grammarians/Fix-flaky-tests-151168e7b01a802aa0a1c773ac29f21e?pvs=4
      fileParallelism: false,
      testTimeout: 10000,
      retry: 2,
    },
  }
})
