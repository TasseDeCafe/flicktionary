import { describe, expect, test } from 'vitest'
import { CoverageSnapshotsRepository } from './coverage-snapshots-repository'
import { sql } from '../postgres-client'
import { __createUserInSupabaseAndGetHisIdAndToken } from '../../../test/test-utils'

const repo = CoverageSnapshotsRepository()

const baseInput = (userId: string, day: string) => ({
  userId,
  targetLanguage: 'ru',
  day,
  buildVersion: 1,
  denominator: 25000,
  studiedCount: 100,
  knownCount: 50,
  mweCount: 5,
  coveragePct: 42.5,
  verifiedPct: 30.1,
})

describe('coverage snapshots', () => {
  test('same-day upserts update in place; a new day appends', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()

    await repo.upsertDaily(baseInput(userId, '2026-07-19'))
    await repo.upsertDaily({
      ...baseInput(userId, '2026-07-19'),
      buildVersion: 2,
      studiedCount: 120,
      coveragePct: 44.0,
    })
    await repo.upsertDaily(baseInput(userId, '2026-07-20'))

    const rows = await sql`
      SELECT day::text, build_version, studied_count, coverage_pct
      FROM public.coverage_snapshots
      WHERE user_id = ${userId} AND target_language = 'ru'
      ORDER BY day
    `
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ day: '2026-07-19', build_version: 2, studied_count: 120 })
    expect(Number(rows[0].coverage_pct)).toBeCloseTo(44.0)
    expect(rows[1]).toMatchObject({ day: '2026-07-20', build_version: 1, studied_count: 100 })
  })
})
