import { describe, expect, it } from 'vitest'
import { declarationExactCount } from './declaration-preview'

describe('declarationExactCount', () => {
  it('is null while the preview is loading', () => {
    expect(declarationExactCount({ status: 'loading' })).toBe(null)
  })

  it('returns the markable count for a ready profile', () => {
    expect(
      declarationExactCount({
        status: 'ready',
        pendingCount: 3,
        markKnownStatus: 'ready',
        markableLemmaCount: 235,
      })
    ).toBe(235)
  })

  it.each(['pending', 'failed', 'unsupported'] as const)('resolves %s to 0 so the sweep step auto-skips', (status) => {
    expect(
      declarationExactCount({
        status: 'ready',
        pendingCount: null,
        markKnownStatus: status,
        markableLemmaCount: 42,
      })
    ).toBe(0)
  })
})
