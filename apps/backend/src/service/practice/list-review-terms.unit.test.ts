import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listReviewTerms, type ListReviewTermsDependencies } from './list-review-terms'

const userId = '00000000-0000-0000-0000-000000000001'

const createDeps = (introducedToday: number) => {
  const repoListReviewTerms = vi.fn().mockResolvedValue([])
  const deps = {
    usersRepository: {
      getPracticeSessionLimits: vi.fn().mockResolvedValue({ maxNewTerms: 20, maxReviewTerms: 100 }),
    },
    userLookupsRepository: {
      listReviewTerms: repoListReviewTerms,
      listDueSummary: vi
        .fn()
        .mockResolvedValue([{ targetLanguage: 'es', newIntroducedTodayCount: introducedToday }]),
    },
  } as unknown as ListReviewTermsDependencies
  return { deps, repoListReviewTerms }
}

describe('listReviewTerms (service caps)', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('passive pool: review cap is the clamped limit; new cap is the daily remainder', async () => {
    const { deps, repoListReviewTerms } = createDeps(7)
    await listReviewTerms(userId, 'es', 'passive', 'mixed', deps)
    expect(repoListReviewTerms).toHaveBeenCalledWith(
      expect.objectContaining({ pool: 'passive', scope: 'mixed', maxReviewTerms: 100, maxNewTerms: 13 })
    )
  })

  it('passive pool: new cap floors at zero once the daily budget is spent', async () => {
    const { deps, repoListReviewTerms } = createDeps(50)
    await listReviewTerms(userId, 'es', 'passive', 'mixed', deps)
    expect(repoListReviewTerms).toHaveBeenCalledWith(expect.objectContaining({ maxNewTerms: 0 }))
  })

  it('active pool: not daily-capped — uses the hard ceilings', async () => {
    const { deps, repoListReviewTerms } = createDeps(0)
    await listReviewTerms(userId, 'es', 'active', 'review_due', deps)
    expect(repoListReviewTerms).toHaveBeenCalledWith(
      expect.objectContaining({ pool: 'active', scope: 'review_due', maxReviewTerms: 300, maxNewTerms: 100 })
    )
  })
})
