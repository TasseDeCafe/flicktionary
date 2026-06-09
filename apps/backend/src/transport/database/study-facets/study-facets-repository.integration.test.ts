import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { StudyFacetsRepository, ensureDefaultCitationFacetIfUnconfigured } from './study-facets-repository'
import { UserLookupsRepository } from '../user-lookups/user-lookups-repository'
import { sql } from '../postgres-client'
import { __createUserInSupabaseAndGetHisIdAndToken, __removeAllAuthUsersFromSupabase } from '../../../test/test-utils'

// These tests exercise the study_facets SQL writers against a real DB: the
// facet identity (user_lookup_id, skill, target_form), the idempotent
// citation-facet creation, the daily-new cap guard, and the leech/rehab/undo
// state transitions that Phase 1 moved off user_lookups.
describe('study-facets-repository integration tests', () => {
  const repo = StudyFacetsRepository()
  const userLookupsRepository = UserLookupsRepository()

  beforeEach(async () => {
    await __removeAllAuthUsersFromSupabase()
  })

  afterAll(async () => {
    await __removeAllAuthUsersFromSupabase()
  })

  // A kept term (count>0) with no facets yet. Deleting the auth user cascades
  // the lookup and its facets away.
  const createKeptTerm = async (userId: string, headword: string) => {
    const lookup = await userLookupsRepository.findOrCreate({
      userId,
      targetLanguage: 'es',
      headword,
      sense: 'cat',
    })
    await sql`UPDATE public.user_lookups SET count = 1 WHERE id = ${lookup.id}`
    return lookup
  }

  test('ensureCitationFacet is idempotent and creates a single unseen recognition facet', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const lookup = await createKeptTerm(userId, 'gato')

    await repo.ensureCitationFacet(lookup.id)
    await repo.ensureCitationFacet(lookup.id)

    const facet = await repo.getFacet({ userLookupId: lookup.id, skill: 'meaning_recognition', targetForm: '' })
    expect(facet).not.toBeNull()
    expect(facet?.srs_state).toBeNull()
    expect(facet?.disabled_at).toBeNull()

    const [{ count }] = (await sql`
      SELECT COUNT(*)::int AS count FROM public.study_facets WHERE user_lookup_id = ${lookup.id}
    `) as Array<{ count: number }>
    expect(count).toBe(1)
  })

  // The keep-time default (applyKeepTransition): recognition is created only
  // for a term with NO facet rows. A pre-keep study-target configuration
  // (pronunciation-only) or a deliberately dormant term (disabled recognition)
  // must survive Keep untouched.
  test('keep default creates recognition only when the term has no facet rows', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()

    // Unconfigured term: the default applies (and is idempotent).
    const plain = await createKeptTerm(userId, 'gato')
    await ensureDefaultCitationFacetIfUnconfigured(plain.id)
    await ensureDefaultCitationFacetIfUnconfigured(plain.id)
    const created = await repo.getFacet({ userLookupId: plain.id, skill: 'meaning_recognition', targetForm: '' })
    expect(created?.srs_state).toBeNull()
    expect(created?.disabled_at).toBeNull()

    // Pronunciation-only configuration made pre-keep: recognition must NOT be added.
    const pronOnly = await createKeptTerm(userId, 'perro')
    await repo.ensureFacet({ userLookupId: pronOnly.id, skill: 'pronunciation', targetForm: '' })
    await ensureDefaultCitationFacetIfUnconfigured(pronOnly.id)
    expect(await repo.getFacet({ userLookupId: pronOnly.id, skill: 'meaning_recognition', targetForm: '' })).toBeNull()

    // Dormant term (recognition explicitly disabled): a re-keep must not resurrect it.
    const dormant = await createKeptTerm(userId, 'pez')
    await repo.ensureCitationFacet(dormant.id)
    await sql`UPDATE public.study_facets SET disabled_at = NOW() WHERE user_lookup_id = ${dormant.id}`
    await ensureDefaultCitationFacetIfUnconfigured(dormant.id)
    const stillDisabled = await repo.getFacet({ userLookupId: dormant.id, skill: 'meaning_recognition', targetForm: '' })
    expect(stillDisabled?.disabled_at).not.toBeNull()
  })

  test('the daily-new cap guard introduces under the cap and refuses over it', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const a = await createKeptTerm(userId, 'uno')
    const b = await createKeptTerm(userId, 'dos')
    await repo.ensureCitationFacet(a.id)
    await repo.ensureCitationFacet(b.id)

    const first = await repo.initializeCitationFacetIfUnderDailyCap({
      userLookupId: a.id,
      userId,
      targetLanguage: 'es',
      maxNewTerms: 1,
    })
    expect(first).toBe(true)

    // The cap (1) is now consumed by `a`'s introduction today.
    const second = await repo.initializeCitationFacetIfUnderDailyCap({
      userLookupId: b.id,
      userId,
      targetLanguage: 'es',
      maxNewTerms: 1,
    })
    expect(second).toBe(false)

    // bypassCap overrides the count predicate but still stamps the row.
    const bypassed = await repo.initializeCitationFacetIfUnderDailyCap({
      userLookupId: b.id,
      userId,
      targetLanguage: 'es',
      maxNewTerms: 1,
      bypassCap: true,
    })
    expect(bypassed).toBe(true)

    const fa = await repo.getFacet({ userLookupId: a.id, skill: 'meaning_recognition', targetForm: '' })
    const fb = await repo.getFacet({ userLookupId: b.id, skill: 'meaning_recognition', targetForm: '' })
    expect(fa?.srs_state).toBe('new')
    expect(fa?.introduced_at).not.toBeNull()
    expect(fb?.srs_state).toBe('new')
  })

  test('FSRS, leech park/rehab/unpark and undo-restore round-trip on the facet', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const lookup = await createKeptTerm(userId, 'gato')
    const address = { userLookupId: lookup.id, skill: 'meaning_recognition' as const, targetForm: '' }
    await repo.ensureCitationFacet(lookup.id)
    await repo.initializeCitationFacetIfUnderDailyCap({
      userLookupId: lookup.id,
      userId,
      targetLanguage: 'es',
      maxNewTerms: 10,
    })

    await repo.applyFsrsResultForFacet({
      ...address,
      state: 'review',
      due: new Date('2026-06-10T00:00:00Z'),
      stability: 10,
      difficulty: 5,
      lastReview: new Date('2026-06-09T00:00:00Z'),
      reps: 1,
      lapses: 0,
    })
    let facet = await repo.getFacet(address)
    expect(facet?.srs_state).toBe('review')
    expect(facet?.srs_reps).toBe(1)

    await repo.parkLeechFacet(address)
    facet = await repo.getFacet(address)
    expect(facet?.leech_parked_at).not.toBeNull()

    const day = await repo.advanceRehabDayFacet(address)
    expect(day).toBe(1)
    // Same-day second advance is a no-op (returns null).
    expect(await repo.advanceRehabDayFacet(address)).toBeNull()

    await repo.unparkAndSoftReentryFacet({
      ...address,
      state: 'review',
      due: new Date('2026-06-11T00:00:00Z'),
      stability: 1,
      difficulty: 5,
      lastReview: new Date('2026-06-10T00:00:00Z'),
    })
    facet = await repo.getFacet(address)
    expect(facet?.leech_parked_at).toBeNull()
    expect(facet?.leech_rehab_correct_days).toBe(0)
    // reps preserved across graduation.
    expect(facet?.srs_reps).toBe(1)

    // Undo an introduction: restore to null state and clear introduced_at.
    await repo.restoreSrsSnapshotForFacet({
      ...address,
      prevState: null,
      prevDue: null,
      prevStability: null,
      prevDifficulty: null,
      prevLastReview: null,
      prevReps: null,
      prevLapses: null,
      wasIntroduction: true,
      causedParking: false,
    })
    facet = await repo.getFacet(address)
    expect(facet?.srs_state).toBeNull()
    expect(facet?.introduced_at).toBeNull()
    expect(facet?.srs_reps).toBe(0)
  })

  test('a production facet is addressed independently of the recognition facet', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const lookup = await createKeptTerm(userId, 'gato')
    await repo.ensureCitationFacet(lookup.id)
    await repo.ensureFacet({ userLookupId: lookup.id, skill: 'meaning_production', targetForm: '' })

    await repo.initializeFacet({ userLookupId: lookup.id, skill: 'meaning_production', targetForm: '' })

    const recognition = await repo.getFacet({ userLookupId: lookup.id, skill: 'meaning_recognition', targetForm: '' })
    const production = await repo.getFacet({ userLookupId: lookup.id, skill: 'meaning_production', targetForm: '' })
    // Initializing production left recognition untouched (still unseen).
    expect(recognition?.srs_state).toBeNull()
    expect(production?.srs_state).toBe('new')
    // initializeFacet (production path) does NOT stamp introduced_at.
    expect(production?.introduced_at).toBeNull()
  })
})
