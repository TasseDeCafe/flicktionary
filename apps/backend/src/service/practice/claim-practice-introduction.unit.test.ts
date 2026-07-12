import { describe, expect, it, vi } from 'vitest'
import { claimPracticeIntroduction } from './claim-practice-introduction'

const base = {
  userId: '00000000-0000-4000-8000-000000000001',
  userLookupId: '00000000-0000-4000-8000-000000000002',
  targetLanguage: 'es',
  pool: 'recognition' as const,
  bypassDailyCap: false,
}

const dependencies = (outcome: 'scaffolded' | 'cap_reached' | 'not_eligible', parked = false) => {
  const initializeAndParkCitationFacetIfUnderDailyCap = vi.fn().mockResolvedValue(outcome)
  const getFacet = vi.fn().mockResolvedValue(parked ? { leech_parked_at: new Date() } : null)
  const findByIdForUser = vi.fn().mockResolvedValue({
    id: base.userLookupId,
    user_id: base.userId,
    target_language: base.targetLanguage,
    count: 1,
    deleted_at: null,
  })
  return {
    deps: {
      studyFacetsRepository: { initializeAndParkCitationFacetIfUnderDailyCap, getFacet },
      userLookupsRepository: { findByIdForUser },
      userTargetLanguagePrefsRepository: {
        getPracticeLimitsForLanguage: vi
          .fn()
          .mockResolvedValue({ maxNewTerms: 15, maxReviewTerms: 100, maxReviewTermsProduction: null }),
      },
    } as never,
    initializeAndParkCitationFacetIfUnderDailyCap,
    findByIdForUser,
  }
}

describe('claimPracticeIntroduction', () => {
  it('claims under the combined cap with the pool citation skill', async () => {
    const { deps, initializeAndParkCitationFacetIfUnderDailyCap } = dependencies('scaffolded')
    await expect(claimPracticeIntroduction({ ...base, deps })).resolves.toBe('claimed')
    expect(initializeAndParkCitationFacetIfUnderDailyCap).toHaveBeenCalledWith({
      userLookupId: base.userLookupId,
      userId: base.userId,
      targetLanguage: 'es',
      skill: 'meaning_recognition',
      maxNewTerms: 15,
      bypassCap: false,
    })
  })

  it('reports a concurrent already-claimed gate as renderable', async () => {
    const { deps } = dependencies('not_eligible', true)
    await expect(claimPracticeIntroduction({ ...base, deps })).resolves.toBe('already_claimed')
  })

  it('distinguishes cap refusal and other ineligible states', async () => {
    const capped = dependencies('cap_reached')
    await expect(claimPracticeIntroduction({ ...base, deps: capped.deps })).resolves.toBe('daily_cap_reached')

    const unavailable = dependencies('not_eligible')
    await expect(claimPracticeIntroduction({ ...base, deps: unavailable.deps })).resolves.toBe('unavailable')
  })

  it('rejects a lookup outside the authenticated user and language before claiming', async () => {
    const { deps, initializeAndParkCitationFacetIfUnderDailyCap, findByIdForUser } = dependencies('scaffolded')
    findByIdForUser.mockResolvedValue(null)
    await expect(claimPracticeIntroduction({ ...base, deps })).resolves.toBe('unavailable')
    expect(initializeAndParkCitationFacetIfUnderDailyCap).not.toHaveBeenCalled()
  })

  it('passes the explicit Learn-extra bypass only at claim time', async () => {
    const { deps, initializeAndParkCitationFacetIfUnderDailyCap } = dependencies('scaffolded')
    await claimPracticeIntroduction({ ...base, pool: 'production', bypassDailyCap: true, deps })
    expect(initializeAndParkCitationFacetIfUnderDailyCap).toHaveBeenCalledWith(
      expect.objectContaining({ skill: 'meaning_production', bypassCap: true })
    )
  })
})
