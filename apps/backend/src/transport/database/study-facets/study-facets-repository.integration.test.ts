import { describe, expect, test } from 'vitest'
import { StudyFacetsRepository, ensureDefaultCitationFacetIfUnconfigured } from './study-facets-repository'
import { UserLookupsRepository } from '../user-lookups/user-lookups-repository'
import { beginTx, sql } from '../postgres-client'
import { __createUserInSupabaseAndGetHisIdAndToken } from '../../../test/test-utils'

// These tests exercise the study_facets SQL writers against a real DB: the
// facet identity (user_lookup_id, skill, target_form), the idempotent
// citation-facet creation, the daily-new cap guard, and the leech/rehab/undo
// state transitions that Phase 1 moved off user_lookups.
describe('study-facets-repository integration tests', () => {
  const repo = StudyFacetsRepository()
  const userLookupsRepository = UserLookupsRepository()

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
    const stillDisabled = await repo.getFacet({
      userLookupId: dormant.id,
      skill: 'meaning_recognition',
      targetForm: '',
    })
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
      skill: 'meaning_recognition',
      maxNewTerms: 1,
    })
    expect(first).toBe(true)

    // The cap (1) is now consumed by `a`'s introduction today.
    const second = await repo.initializeCitationFacetIfUnderDailyCap({
      userLookupId: b.id,
      userId,
      targetLanguage: 'es',
      skill: 'meaning_recognition',
      maxNewTerms: 1,
    })
    expect(second).toBe(false)

    const fa = await repo.getFacet({ userLookupId: a.id, skill: 'meaning_recognition', targetForm: '' })
    const fb = await repo.getFacet({ userLookupId: b.id, skill: 'meaning_recognition', targetForm: '' })
    expect(fa?.srs_state).toBe('new')
    expect(fa?.introduced_at).not.toBeNull()
    expect(fb?.srs_state).toBeNull()
  })

  test('the daily-new cap guard refuses parked warm-up facets', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const lookup = await createKeptTerm(userId, 'warmup')
    await repo.ensureCitationFacet(lookup.id)

    const warmup = await repo.initializeAndParkCitationFacetIfUnderDailyCap({
      userLookupId: lookup.id,
      userId,
      targetLanguage: 'es',
      skill: 'meaning_recognition',
      maxNewTerms: 10,
    })
    expect(warmup).toBe('scaffolded')

    const introduced = await repo.initializeCitationFacetIfUnderDailyCap({
      userLookupId: lookup.id,
      userId,
      targetLanguage: 'es',
      skill: 'meaning_recognition',
      maxNewTerms: 10,
    })
    expect(introduced).toBe(false)

    const facet = await repo.getFacet({ userLookupId: lookup.id, skill: 'meaning_recognition', targetForm: '' })
    expect(facet?.srs_state).toBeNull()
    expect(facet?.leech_parked_at).not.toBeNull()
  })

  test('the warm-up park guard reports cap_reached over the cap; bypassCap parks past it and still stamps introduced_at', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const a = await createKeptTerm(userId, 'uno')
    const b = await createKeptTerm(userId, 'dos')
    await repo.ensureCitationFacet(a.id)
    await repo.ensureCitationFacet(b.id)

    const first = await repo.initializeAndParkCitationFacetIfUnderDailyCap({
      userLookupId: a.id,
      userId,
      targetLanguage: 'es',
      skill: 'meaning_recognition',
      maxNewTerms: 1,
    })
    expect(first).toBe('scaffolded')

    const second = await repo.initializeAndParkCitationFacetIfUnderDailyCap({
      userLookupId: b.id,
      userId,
      targetLanguage: 'es',
      skill: 'meaning_recognition',
      maxNewTerms: 1,
    })
    expect(second).toBe('cap_reached')

    // Learn-extra: bypassCap skips only the count predicate — the park still
    // stamps introduced_at (counts toward today) and leaves srs_state NULL.
    const bypassed = await repo.initializeAndParkCitationFacetIfUnderDailyCap({
      userLookupId: b.id,
      userId,
      targetLanguage: 'es',
      skill: 'meaning_recognition',
      maxNewTerms: 1,
      bypassCap: true,
    })
    expect(bypassed).toBe('scaffolded')

    const facet = await repo.getFacet({ userLookupId: b.id, skill: 'meaning_recognition', targetForm: '' })
    expect(facet?.srs_state).toBeNull()
    expect(facet?.leech_parked_at).not.toBeNull()
    expect(facet?.introduced_at).not.toBeNull()

    // Already parked → not_eligible even with the bypass (idempotence).
    const again = await repo.initializeAndParkCitationFacetIfUnderDailyCap({
      userLookupId: b.id,
      userId,
      targetLanguage: 'es',
      skill: 'meaning_recognition',
      maxNewTerms: 1,
      bypassCap: true,
    })
    expect(again).toBe('not_eligible')
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
      skill: 'meaning_recognition',
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
      learningSteps: 1,
    })
    let facet = await repo.getFacet(address)
    expect(facet?.srs_state).toBe('review')
    expect(facet?.srs_reps).toBe(1)
    expect(facet?.srs_learning_steps).toBe(1)

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
    // reps preserved across graduation; the ladder position resets so a later
    // lapse starts the relearning ladder from step 0.
    expect(facet?.srs_reps).toBe(1)
    expect(facet?.srs_learning_steps).toBe(0)

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
      prevLearningSteps: null,
      wasIntroduction: true,
      causedParking: false,
    })
    facet = await repo.getFacet(address)
    expect(facet?.srs_state).toBeNull()
    expect(facet?.introduced_at).toBeNull()
    expect(facet?.srs_reps).toBe(0)
    expect(facet?.srs_learning_steps).toBe(0)
  })

  test('a production facet is addressed independently of the recognition facet', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const lookup = await createKeptTerm(userId, 'gato')
    await repo.ensureCitationFacet(lookup.id)
    await repo.ensureFacet({ userLookupId: lookup.id, skill: 'meaning_production', targetForm: '' })

    const introduced = await repo.initializeCitationFacetIfUnderDailyCap({
      userLookupId: lookup.id,
      userId,
      targetLanguage: 'es',
      skill: 'meaning_production',
      maxNewTerms: 10,
    })
    expect(introduced).toBe(true)

    const recognition = await repo.getFacet({ userLookupId: lookup.id, skill: 'meaning_recognition', targetForm: '' })
    const production = await repo.getFacet({ userLookupId: lookup.id, skill: 'meaning_production', targetForm: '' })
    // Introducing production left recognition untouched (still unseen).
    expect(recognition?.srs_state).toBeNull()
    expect(production?.srs_state).toBe('new')
    // Production citation intros consume the combined budget -> stamped.
    expect(production?.introduced_at).not.toBeNull()
  })

  test('both pools consume ONE combined daily budget (a production intro blocks a recognition one)', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const prodTerm = await createKeptTerm(userId, 'uno')
    const recogTerm = await createKeptTerm(userId, 'dos')
    await repo.ensureCitationFacet(prodTerm.id)
    await repo.ensureCitationFacet(recogTerm.id)
    await repo.ensureFacet({ userLookupId: prodTerm.id, skill: 'meaning_production', targetForm: '' })

    const production = await repo.initializeAndParkCitationFacetIfUnderDailyCap({
      userLookupId: prodTerm.id,
      userId,
      targetLanguage: 'es',
      skill: 'meaning_production',
      maxNewTerms: 1,
    })
    expect(production).toBe('scaffolded')

    // The single slot is spent by the production intro — recognition refuses.
    const recognition = await repo.initializeAndParkCitationFacetIfUnderDailyCap({
      userLookupId: recogTerm.id,
      userId,
      targetLanguage: 'es',
      skill: 'meaning_recognition',
      maxNewTerms: 1,
    })
    expect(recognition).toBe('cap_reached')

    // Opt-in facets never touch the budget: a pronunciation intro still lands
    // for a capped-out user, and stays unstamped.
    await repo.ensureFacet({ userLookupId: recogTerm.id, skill: 'pronunciation', targetForm: '' })
    await repo.initializeFacet({ userLookupId: recogTerm.id, skill: 'pronunciation', targetForm: '' })
    const pron = await repo.getFacet({ userLookupId: recogTerm.id, skill: 'pronunciation', targetForm: '' })
    expect(pron?.srs_state).toBe('new')
    expect(pron?.introduced_at).toBeNull()
  })

  // The locked reads are the serialization point between every SRS writer
  // (rating, checkpoint batch credit, the undo paths) — verify they really
  // hold row locks. Probed deterministically from a second pool connection
  // with FOR UPDATE NOWAIT (55P03 = lock_not_available) instead of timing.
  test('getFacetForUpdate holds the facet row lock until the transaction ends', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const lookup = await createKeptTerm(userId, 'cerradura')
    await repo.ensureCitationFacet(lookup.id)

    await beginTx(async (tx) => {
      const locked = await repo.getFacetForUpdate(
        { userLookupId: lookup.id, skill: 'meaning_recognition', targetForm: '' },
        tx
      )
      expect(locked).not.toBeNull()
      await expect(
        sql`SELECT id FROM public.study_facets WHERE user_lookup_id = ${lookup.id} FOR UPDATE NOWAIT`
      ).rejects.toMatchObject({ code: '55P03' })
    })

    // After commit the row is free again.
    const freed = (await sql`
      SELECT id FROM public.study_facets WHERE user_lookup_id = ${lookup.id} FOR UPDATE NOWAIT
    `) as Array<{ id: string }>
    expect(freed.length).toBe(1)
  })

  test('listFacetsByLookupIdsForUpdate locks every returned row, ordered by lookup id', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const a = await createKeptTerm(userId, 'llave')
    const b = await createKeptTerm(userId, 'candado')
    await repo.ensureCitationFacet(a.id)
    await repo.ensureCitationFacet(b.id)

    await beginTx(async (tx) => {
      const rows = await repo.listFacetsByLookupIdsForUpdate(
        { userLookupIds: [b.id, a.id], skill: 'meaning_recognition', targetForm: '' },
        tx
      )
      expect(rows.map((r) => r.user_lookup_id)).toEqual([a.id, b.id].sort())
      for (const lookupId of [a.id, b.id]) {
        await expect(
          sql`SELECT id FROM public.study_facets WHERE user_lookup_id = ${lookupId} FOR UPDATE NOWAIT`
        ).rejects.toMatchObject({ code: '55P03' })
      }
    })
  })
})
