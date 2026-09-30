import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listDueReviewTerms, type ListDueReviewTermsDependencies } from './list-due-review-terms'

const userId = '00000000-0000-0000-0000-000000000001'

const createDeps = (opts: { reviewedToday?: number; maxReviewTermsProduction?: number | null } = {}) => {
  const repoListDueReviewTerms = vi.fn().mockResolvedValue([])
  const countReviewBudgetConsumedToday = vi.fn().mockResolvedValue(opts.reviewedToday ?? 0)
  const deps = {
    userTargetLanguagePrefsRepository: {
      getPracticeLimitsForLanguage: vi.fn().mockResolvedValue({
        maxNewTerms: 20,
        maxReviewTerms: 100,
        maxReviewTermsProduction: opts.maxReviewTermsProduction ?? null,
      }),
    },
    userLookupsRepository: {
      listDueReviewTerms: repoListDueReviewTerms,
    },
    practiceRatingEventsRepository: {
      countReviewBudgetConsumedToday,
    },
  } as unknown as ListDueReviewTermsDependencies
  return { deps, repoListDueReviewTerms, countReviewBudgetConsumedToday }
}

describe('listDueReviewTerms (service caps)', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('recognition pool: review cap is the clamped limit', async () => {
    const { deps, repoListDueReviewTerms } = createDeps()
    await listDueReviewTerms(userId, 'es', 'recognition', deps)
    expect(repoListDueReviewTerms).toHaveBeenCalledWith(
      expect.objectContaining({ pool: 'recognition', maxReviewTerms: 100 })
    )
  })

  it('recognition pool: reviews done today shrink the review budget', async () => {
    const { deps, repoListDueReviewTerms, countReviewBudgetConsumedToday } = createDeps({ reviewedToday: 30 })
    await listDueReviewTerms(userId, 'es', 'recognition', deps)
    expect(countReviewBudgetConsumedToday).toHaveBeenCalledWith({
      userId,
      targetLanguage: 'es',
      pool: 'recognition',
    })
    expect(repoListDueReviewTerms).toHaveBeenCalledWith(expect.objectContaining({ maxReviewTerms: 70 }))
  })

  it('recognition pool: an exhausted review budget floors at zero (no refill on refetch)', async () => {
    const { deps, repoListDueReviewTerms } = createDeps({ reviewedToday: 150 })
    await listDueReviewTerms(userId, 'es', 'recognition', deps)
    expect(repoListDueReviewTerms).toHaveBeenCalledWith(expect.objectContaining({ maxReviewTerms: 0 }))
  })

  it('recognition pool: learning follow-ups stay exempt — maxLearningTerms is the hard ceiling even with a spent budget', async () => {
    const { deps, repoListDueReviewTerms } = createDeps({ reviewedToday: 150 })
    await listDueReviewTerms(userId, 'es', 'recognition', deps)
    expect(repoListDueReviewTerms).toHaveBeenCalledWith(expect.objectContaining({ maxLearningTerms: 300 }))
  })

  it('production pool: uncapped review (NULL cap) uses the hard review ceilings', async () => {
    const { deps, repoListDueReviewTerms, countReviewBudgetConsumedToday } = createDeps()
    await listDueReviewTerms(userId, 'es', 'production', deps)
    expect(countReviewBudgetConsumedToday).not.toHaveBeenCalled()
    expect(repoListDueReviewTerms).toHaveBeenCalledWith(
      expect.objectContaining({ pool: 'production', maxReviewTerms: 300, maxLearningTerms: 300 })
    )
  })

  it('production pool: a SET review cap counts the production budget and shrinks the cap', async () => {
    const { deps, repoListDueReviewTerms, countReviewBudgetConsumedToday } = createDeps({
      maxReviewTermsProduction: 40,
      reviewedToday: 15,
    })
    await listDueReviewTerms(userId, 'es', 'production', deps)
    expect(countReviewBudgetConsumedToday).toHaveBeenCalledWith({ userId, targetLanguage: 'es', pool: 'production' })
    expect(repoListDueReviewTerms).toHaveBeenCalledWith(expect.objectContaining({ maxReviewTerms: 25 }))
  })
})
