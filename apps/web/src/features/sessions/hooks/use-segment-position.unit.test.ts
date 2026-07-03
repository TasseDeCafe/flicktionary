import { describe, expect, it } from 'vitest'
import { segmentPositionFromEntry } from './use-segment-position'

const entry = (overrides: {
  isIntersecting: boolean
  rootTop?: number | null
  targetTop?: number
}): Parameters<typeof segmentPositionFromEntry>[0] => ({
  isIntersecting: overrides.isIntersecting,
  rootBounds: overrides.rootTop === null ? null : { top: overrides.rootTop ?? 0 },
  boundingClientRect: { top: overrides.targetTop ?? 0 },
})

describe('segmentPositionFromEntry', () => {
  it('is visible whenever the entry intersects, regardless of tops', () => {
    expect(segmentPositionFromEntry(entry({ isIntersecting: true, rootTop: 100, targetTop: 0 }))).toBe('visible')
  })

  it('is above when the target top is over the root top', () => {
    expect(segmentPositionFromEntry(entry({ isIntersecting: false, rootTop: 100, targetTop: 40 }))).toBe('above')
  })

  it('is below when the target top is under the root top', () => {
    expect(segmentPositionFromEntry(entry({ isIntersecting: false, rootTop: 100, targetTop: 900 }))).toBe('below')
  })

  it('falls back to a root top of 0 when rootBounds is null', () => {
    expect(segmentPositionFromEntry(entry({ isIntersecting: false, rootTop: null, targetTop: -5 }))).toBe('above')
    expect(segmentPositionFromEntry(entry({ isIntersecting: false, rootTop: null, targetTop: 5 }))).toBe('below')
  })
})
