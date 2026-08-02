import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import NodeCache from 'node-cache'
import { incrementFixedWindowCount } from './fixed-window-counter'

describe('incrementFixedWindowCount', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('counts successive attempts for the same key', () => {
    const cache = new NodeCache({ stdTTL: 60 * 60 })

    expect(incrementFixedWindowCount(cache, 'a@example.com')).toBe(1)
    expect(incrementFixedWindowCount(cache, 'a@example.com')).toBe(2)
    expect(incrementFixedWindowCount(cache, 'b@example.com')).toBe(1)
    expect(cache.get<number>('a@example.com')).toBe(2)
  })

  test('keeps the window fixed from the first attempt instead of sliding on each write', () => {
    const cache = new NodeCache({ stdTTL: 60 * 60 })

    incrementFixedWindowCount(cache, 'a@example.com')
    vi.advanceTimersByTime(50 * 60 * 1000)
    // With a plain cache.set() this write would restart the one-hour TTL
    incrementFixedWindowCount(cache, 'a@example.com')
    vi.advanceTimersByTime(11 * 60 * 1000)

    expect(cache.get<number>('a@example.com')).toBeUndefined()
  })

  test('starts a fresh window after the previous one expires', () => {
    const cache = new NodeCache({ stdTTL: 60 * 60 })

    incrementFixedWindowCount(cache, 'a@example.com')
    incrementFixedWindowCount(cache, 'a@example.com')
    vi.advanceTimersByTime(61 * 60 * 1000)

    expect(incrementFixedWindowCount(cache, 'a@example.com')).toBe(1)

    vi.advanceTimersByTime(59 * 60 * 1000)
    expect(cache.get<number>('a@example.com')).toBe(1)
  })
})
