import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig(() => {
  const testPatterns = {
    unit: ['./src/**/*.unit.test.{ts,tsx,js,jsx}'],
    integration: ['./src/**/*.integration.test.{ts,tsx,js,jsx}'],
    default: ['./src/**/*.test.{ts,tsx,js,jsx}'],
  }

  const getTestPatterns = (testType: string | undefined) => {
    switch (testType) {
      case 'unit':
        return testPatterns.unit
      case 'integration':
        return testPatterns.integration
      default:
        return testPatterns.default
    }
  }

  const include = getTestPatterns(process.env.VITEST_ENV)

  return {
    plugins: [tsconfigPaths()],
    test: {
      include,
      exclude: ['dist/**'],
      pool: 'threads',
      maxWorkers: 1,
      // this flag is explained here: https://vitest.dev/config/#fileparallelism
      // this is an attempt to solve the problem with flaky tests in this ticket
      // https://www.notion.so/grammarians/Fix-flaky-tests-151168e7b01a802aa0a1c773ac29f21e?pvs=4
      // here we have no integration tests, so it can be set to true
      fileParallelism: true,
      testTimeout: 10000,
    },
  }
})
