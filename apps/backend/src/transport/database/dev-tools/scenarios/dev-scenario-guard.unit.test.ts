import { describe, expect, test } from 'vitest'
import { assertDevTunnelNodeEnv, assertDevTunnelTarget, assertScenarioEmail } from './dev-scenario-guard'

const SUPABASE = 'http://127.0.0.1:34321'
const DB = 'postgresql://postgres:postgres@127.0.0.1:34322/postgres'

describe('dev-scenario guard', () => {
  test('accepts the dev-tunnel NODE_ENV only', () => {
    expect(() => assertDevTunnelNodeEnv('development-tunnel')).not.toThrow()
    for (const env of ['production', 'test', 'development', undefined]) {
      expect(() => assertDevTunnelNodeEnv(env)).toThrow(/dev tunnel/)
    }
  })

  test('accepts the local dev-tunnel database and auth', () => {
    expect(() => assertDevTunnelTarget({ connectionString: DB, supabaseUrl: SUPABASE })).not.toThrow()
    expect(() =>
      assertDevTunnelTarget({
        connectionString: 'postgresql://postgres:postgres@localhost:34322/postgres',
        supabaseUrl: 'http://localhost:34321',
      })
    ).not.toThrow()
  })

  test.each([
    ['the test stack', 'postgresql://postgres:postgres@127.0.0.1:64322/postgres'],
    ['the non-tunnel dev stack', 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'],
    ['a remote host on the tunnel port', 'postgresql://postgres:secret@db.example.supabase.co:34322/postgres'],
    ['a malformed string', 'not a url'],
  ])('refuses %s', (_label, connectionString) => {
    expect(() => assertDevTunnelTarget({ connectionString, supabaseUrl: SUPABASE })).toThrow(/refuses database/)
  })

  test('masks the password when refusing', () => {
    expect(() =>
      assertDevTunnelTarget({
        connectionString: 'postgresql://postgres:hunter2@db.example.com:5432/postgres',
        supabaseUrl: SUPABASE,
      })
    ).toThrow(/postgres:\*\*\*\*@db\.example\.com/)
  })

  test('refuses a remote Supabase auth URL', () => {
    expect(() => assertDevTunnelTarget({ connectionString: DB, supabaseUrl: 'https://abc.supabase.co' })).toThrow(
      /refuses Supabase auth/
    )
  })

  test('only accepts dev-scenario accounts', () => {
    expect(() => assertScenarioEmail('dev-scenario@flicktionary.app')).not.toThrow()
    expect(() => assertScenarioEmail('Dev-Scenario-2@example.com')).not.toThrow()
    expect(() => assertScenarioEmail('me@example.com')).toThrow(/dev-scenario/)
    expect(() => assertScenarioEmail('dev-scenario')).toThrow(/dev-scenario/)
  })
})
