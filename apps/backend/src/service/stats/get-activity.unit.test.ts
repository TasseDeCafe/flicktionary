import { describe, expect, test } from 'vitest'
import { buildDayWindow, computeStreakDays, getActivity, ACTIVITY_WINDOW_DAYS } from './get-activity'
import type { StatsRepositoryInterface } from '../../transport/database/stats/stats-repository'

describe('buildDayWindow', () => {
  test('ends on today, oldest first, crossing a month boundary', () => {
    expect(buildDayWindow('2026-07-02', 4)).toEqual(['2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02'])
  })
})

describe('computeStreakDays', () => {
  test('counts a run ending today', () => {
    expect(computeStreakDays(['2026-07-21', '2026-07-20', '2026-07-19'], '2026-07-21')).toBe(3)
  })

  test('a quiet today falls back to the run ending yesterday', () => {
    expect(computeStreakDays(['2026-07-20', '2026-07-19'], '2026-07-21')).toBe(2)
  })

  test('a gap before yesterday means zero', () => {
    expect(computeStreakDays(['2026-07-18', '2026-07-17'], '2026-07-21')).toBe(0)
  })

  test('a gap inside the history stops the run', () => {
    expect(computeStreakDays(['2026-07-21', '2026-07-19'], '2026-07-21')).toBe(1)
  })

  test('no activity at all is zero', () => {
    expect(computeStreakDays([], '2026-07-21')).toBe(0)
  })
})

describe('getActivity', () => {
  test('zero-fills the window per language and drops rows outside it', async () => {
    const statsRepository: StatsRepositoryInterface = {
      getCurrentDay: async () => '2026-07-21',
      countIntroducedByDay: async () => [
        { day: '2026-07-21', targetLanguage: 'ru', count: 2 },
        { day: '2026-07-20', targetLanguage: 'de', count: 5 },
        // A row the SQL window would normally exclude — assembly must not throw.
        { day: '2026-01-01', targetLanguage: 'ru', count: 9 },
      ],
      countMarkedKnownByDay: async () => [{ day: '2026-07-21', targetLanguage: 'ru', count: 40 }],
      listActiveDays: async () => ['2026-07-21', '2026-07-20'],
    }

    const activity = await getActivity({ userId: 'user' }, { statsRepository })

    expect(activity.days).toHaveLength(ACTIVITY_WINDOW_DAYS)
    expect(activity.days.at(-1)).toBe('2026-07-21')
    expect(activity.streakDays).toBe(2)
    // Sorted by language; arrays aligned to days with zeros elsewhere.
    expect(activity.perLanguage.map((l) => l.targetLanguage)).toEqual(['de', 'ru'])
    const ru = activity.perLanguage[1]
    expect(ru.newTerms.at(-1)).toBe(2)
    expect(ru.markedKnown.at(-1)).toBe(40)
    expect(ru.newTerms.reduce((a, b) => a + b, 0)).toBe(2)
    const de = activity.perLanguage[0]
    expect(de.newTerms.at(-2)).toBe(5)
    expect(de.markedKnown.every((n) => n === 0)).toBe(true)
  })
})
