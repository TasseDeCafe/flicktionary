import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listReviewTerms, type ListReviewTermsDependencies } from './list-review-terms'

const userId = '00000000-0000-0000-0000-000000000001'

const createDeps = (
  opts: { introducedToday?: number; reviewedToday?: number; maxReviewTermsProduction?: number | null } = {}
) => {
  const repoListReviewTerms = vi.fn().mockResolvedValue([])
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
      listReviewTerms: repoListReviewTerms,
      listDueSummary: vi
        .fn()
        .mockResolvedValue([{ targetLanguage: 'es', newIntroducedTodayCount: opts.introducedToday ?? 0 }]),
    },
    practiceRatingEventsRepository: {
      countReviewBudgetConsumedToday,
    },
  } as unknown as ListReviewTermsDependencies
  return { deps, repoListReviewTerms, countReviewBudgetConsumedToday }
}

describe('listReviewTerms (service caps)', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('recognition pool: review cap is the clamped limit; new cap is the daily remainder', async () => {
    const { deps, repoListReviewTerms } = createDeps({ introducedToday: 7 })
    await listReviewTerms(userId, 'es', 'recognition', 'mixed', deps)
    expect(repoListReviewTerms).toHaveBeenCalledWith(
      expect.objectContaining({ pool: 'recognition', scope: 'mixed', maxReviewTerms: 100, maxNewTerms: 13 })
    )
  })

  it('recognition pool: new cap floors at zero once the daily budget is spent', async () => {
    const { deps, repoListReviewTerms } = createDeps({ introducedToday: 50 })
    await listReviewTerms(userId, 'es', 'recognition', 'mixed', deps)
    expect(repoListReviewTerms).toHaveBeenCalledWith(expect.objectContaining({ maxNewTerms: 0 }))
  })

  it('recognition pool: reviews done today shrink the review budget', async () => {
    const { deps, repoListReviewTerms, countReviewBudgetConsumedToday } = createDeps({ reviewedToday: 30 })
    await listReviewTerms(userId, 'es', 'recognition', 'mixed', deps)
    expect(countReviewBudgetConsumedToday).toHaveBeenCalledWith({
      userId,
      targetLanguage: 'es',
      pool: 'recognition',
    })
    expect(repoListReviewTerms).toHaveBeenCalledWith(expect.objectContaining({ maxReviewTerms: 70 }))
  })

  it('recognition pool: an exhausted review budget floors at zero (no refill on refetch)', async () => {
    const { deps, repoListReviewTerms } = createDeps({ reviewedToday: 150 })
    await listReviewTerms(userId, 'es', 'recognition', 'mixed', deps)
    expect(repoListReviewTerms).toHaveBeenCalledWith(expect.objectContaining({ maxReviewTerms: 0 }))
  })

  it('recognition pool: learning follow-ups stay exempt — maxLearningTerms is the hard ceiling even with a spent budget', async () => {
    const { deps, repoListReviewTerms } = createDeps({ reviewedToday: 150 })
    await listReviewTerms(userId, 'es', 'recognition', 'mixed', deps)
    expect(repoListReviewTerms).toHaveBeenCalledWith(expect.objectContaining({ maxLearningTerms: 300 }))
  })

  it('learn_new with requestedNewCount serves exactly the batch, ignoring the spent daily-new budget', async () => {
    const { deps, repoListReviewTerms } = createDeps({ introducedToday: 50 })
    await listReviewTerms(userId, 'es', 'recognition', 'learn_new', deps, { requestedNewCount: 10 })
    expect(repoListReviewTerms).toHaveBeenCalledWith(expect.objectContaining({ scope: 'learn_new', maxNewTerms: 10 }))
  })

  it('learn_new requestedNewCount is clamped to the hard ceiling', async () => {
    const { deps, repoListReviewTerms } = createDeps()
    await listReviewTerms(userId, 'es', 'recognition', 'learn_new', deps, { requestedNewCount: 500 })
    expect(repoListReviewTerms).toHaveBeenCalledWith(expect.objectContaining({ maxNewTerms: 100 }))
  })

  it('learn_new WITHOUT requestedNewCount keeps the daily-remaining math (reading generator path)', async () => {
    const { deps, repoListReviewTerms } = createDeps({ introducedToday: 50 })
    await listReviewTerms(userId, 'es', 'recognition', 'learn_new', deps)
    expect(repoListReviewTerms).toHaveBeenCalledWith(expect.objectContaining({ maxNewTerms: 0 }))
  })

  it('requestedNewCount does not loosen caps outside learn_new', async () => {
    const { deps, repoListReviewTerms } = createDeps({ introducedToday: 50 })
    await listReviewTerms(userId, 'es', 'recognition', 'mixed', deps, { requestedNewCount: 10 })
    expect(repoListReviewTerms).toHaveBeenCalledWith(expect.objectContaining({ maxNewTerms: 0 }))
  })

  it('production pool: uncapped review (NULL cap) — uses the hard ceilings, no budget count', async () => {
    const { deps, repoListReviewTerms, countReviewBudgetConsumedToday } = createDeps()
    await listReviewTerms(userId, 'es', 'production', 'review_due', deps)
    expect(countReviewBudgetConsumedToday).not.toHaveBeenCalled()
    expect(repoListReviewTerms).toHaveBeenCalledWith(
      expect.objectContaining({
        pool: 'production',
        scope: 'review_due',
        maxReviewTerms: 300,
        maxLearningTerms: 300,
        maxNewTerms: 100,
        maxOptInNewTerms: 0,
      })
    )
  })

  it('production pool: a SET review cap counts the production budget and shrinks the cap', async () => {
    const { deps, repoListReviewTerms, countReviewBudgetConsumedToday } = createDeps({
      maxReviewTermsProduction: 40,
      reviewedToday: 15,
    })
    await listReviewTerms(userId, 'es', 'production', 'review_due', deps)
    expect(countReviewBudgetConsumedToday).toHaveBeenCalledWith({ userId, targetLanguage: 'es', pool: 'production' })
    expect(repoListReviewTerms).toHaveBeenCalledWith(expect.objectContaining({ maxReviewTerms: 25 }))
  })

  it('opt-in new is served only in learn_new (recognition): a hard ceiling there, zero in mixed', async () => {
    const learn = createDeps()
    await listReviewTerms(userId, 'es', 'recognition', 'learn_new', learn.deps)
    expect(learn.repoListReviewTerms).toHaveBeenCalledWith(expect.objectContaining({ maxOptInNewTerms: 100 }))

    const mixed = createDeps()
    await listReviewTerms(userId, 'es', 'recognition', 'mixed', mixed.deps)
    expect(mixed.repoListReviewTerms).toHaveBeenCalledWith(expect.objectContaining({ maxOptInNewTerms: 0 }))
  })

  it('production pool learn_new opens the opt-in bucket too (production form facets are opt-in)', async () => {
    const learn = createDeps()
    await listReviewTerms(userId, 'es', 'production', 'learn_new', learn.deps)
    expect(learn.repoListReviewTerms).toHaveBeenCalledWith(expect.objectContaining({ maxOptInNewTerms: 100 }))

    const mixed = createDeps()
    await listReviewTerms(userId, 'es', 'production', 'mixed', mixed.deps)
    expect(mixed.repoListReviewTerms).toHaveBeenCalledWith(expect.objectContaining({ maxOptInNewTerms: 0 }))
  })

  it('excludeCurrentReadingTerms (generator path) drops terms embedded in the current reading text', async () => {
    const { deps, repoListReviewTerms } = createDeps()
    ;(deps as ListReviewTermsDependencies).practiceTextsRepository = {
      findCurrentReading: vi.fn().mockResolvedValue({
        annotations: [{ headword: 'gato', sense: 'cat' }],
      }),
    } as unknown as ListReviewTermsDependencies['practiceTextsRepository']
    ;(deps.userLookupsRepository.listChunkContentForKeys as unknown as ReturnType<typeof vi.fn>) = vi
      .fn()
      .mockResolvedValue([
        { id: '00000000-0000-0000-0000-0000000000aa', headword: 'gato', sense: 'cat' },
        { id: '00000000-0000-0000-0000-0000000000bb', headword: 'perro', sense: 'dog' },
      ])

    await listReviewTerms(userId, 'es', 'recognition', 'mixed', deps, { excludeCurrentReadingTerms: true })

    expect(repoListReviewTerms).toHaveBeenCalledWith(
      expect.objectContaining({ excludeUserLookupIds: ['00000000-0000-0000-0000-0000000000aa'] })
    )
  })

  it('the flashcard path (no option) serves current-reading terms — an abandoned reading must not starve the queue', async () => {
    const { deps, repoListReviewTerms } = createDeps()
    const findCurrentReading = vi.fn().mockResolvedValue({
      annotations: [{ headword: 'gato', sense: 'cat' }],
    })
    ;(deps as ListReviewTermsDependencies).practiceTextsRepository = {
      findCurrentReading,
    } as unknown as ListReviewTermsDependencies['practiceTextsRepository']

    await listReviewTerms(userId, 'es', 'recognition', 'mixed', deps)

    expect(findCurrentReading).not.toHaveBeenCalled()
    expect(repoListReviewTerms).toHaveBeenCalledWith(expect.objectContaining({ excludeUserLookupIds: [] }))
  })
})
