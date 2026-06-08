import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { UserLookupsRepository } from './user-lookups-repository'
import { StudyFacetsRepository } from '../study-facets/study-facets-repository'
import { PracticeRatingEventsRepository } from '../practice-rating-events/practice-rating-events-repository'
import { sql } from '../postgres-client'
import { __createUserInSupabaseAndGetHisIdAndToken, __removeAllAuthUsersFromSupabase } from '../../../test/test-utils'

// Phase-2 facet plumbing against a real DB: the per-facet review budget
// (COUNT DISTINCT (lookup, skill, target_form)), facet-keyed undo lookup, the
// queue's sibling spacing, and the opt-in-new bucket split. These exercise the
// MULTI-facet shapes that the product paths can't build until Phase 4 — we
// insert form facets directly to prove the machinery is ready.
describe('listReviewTerms + rating-event budget: facet plumbing', () => {
  const userLookupsRepository = UserLookupsRepository()
  const studyFacetsRepository = StudyFacetsRepository()
  const ratingEventsRepository = PracticeRatingEventsRepository()

  beforeEach(async () => {
    await __removeAllAuthUsersFromSupabase()
  })
  afterAll(async () => {
    await __removeAllAuthUsersFromSupabase()
  })

  const createKeptTerm = async (userId: string, headword: string) => {
    const lookup = await userLookupsRepository.findOrCreate({ userId, targetLanguage: 'es', headword, sense: 'x' })
    await sql`UPDATE public.user_lookups SET count = 1 WHERE id = ${lookup.id}`
    return lookup
  }

  // Insert a facet row directly (the only way to build form/multi facets before
  // Phase 4). `srsDue` null + `srsState` null => a never-seen (new) facet.
  const insertFacet = async (params: {
    userLookupId: string
    userId: string
    skill: 'meaning_recognition' | 'meaning_production' | 'pronunciation'
    targetForm: string
    srsState: 'new' | 'review' | null
    srsDue: string | null
    dataStatus?: 'ready' | 'pending_data'
    disabledAt?: string | null
  }) => {
    await sql`
      INSERT INTO public.study_facets
        (user_lookup_id, user_id, target_language, skill, target_form, srs_state, srs_due, data_status, disabled_at)
      VALUES (${params.userLookupId}, ${params.userId}, 'es', ${params.skill}, ${params.targetForm},
              ${params.srsState}, ${params.srsDue}, ${params.dataStatus ?? 'ready'}, ${params.disabledAt ?? null})
    `
  }

  const logReview = (params: {
    userId: string
    userLookupId: string
    skill: 'meaning_recognition' | 'meaning_production'
    targetForm: string
  }) =>
    ratingEventsRepository.insert({
      userId: params.userId,
      userLookupId: params.userLookupId,
      targetLanguage: 'es',
      pool: params.skill === 'meaning_production' ? 'active' : 'passive',
      skill: params.skill,
      targetForm: params.targetForm,
      rating: 'good',
      wasExplicit: true,
      wasIntroduction: false,
      causedParking: false,
      practiceTextId: null,
      headword: 'h',
      sense: 'x',
      // review-state pre-snapshot => charges the review budget.
      prevSrsState: 'review',
      prevSrsDue: '2026-06-01T00:00:00Z',
      prevSrsStability: 5,
      prevSrsDifficulty: 5,
      prevSrsLastReview: '2026-05-20T00:00:00Z',
      prevSrsReps: 3,
      prevSrsLapses: 0,
    })

  test('review budget counts DISTINCT facets, not terms, and refunds on revert', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const term = await createKeptTerm(userId, 'gato')
    await studyFacetsRepository.ensureCitationFacet(term.id)
    await insertFacet({
      userLookupId: term.id,
      userId,
      skill: 'meaning_recognition',
      targetForm: 'gatos',
      srsState: 'review',
      srsDue: '2026-06-01T00:00:00Z',
    })

    // Two distinct recognition facets of ONE term -> 2 budget slots.
    await logReview({ userId, userLookupId: term.id, skill: 'meaning_recognition', targetForm: '' })
    const formEventId = await logReview({
      userId,
      userLookupId: term.id,
      skill: 'meaning_recognition',
      targetForm: 'gatos',
    })
    // A redrill of the citation facet is the SAME triple -> still one slot.
    await logReview({ userId, userLookupId: term.id, skill: 'meaning_recognition', targetForm: '' })

    expect(
      await ratingEventsRepository.countReviewBudgetConsumedToday({ userId, targetLanguage: 'es', mode: 'recognition' })
    ).toBe(2)

    // Reverting the form facet's event refunds its slot.
    await ratingEventsRepository.markReverted({ eventId: formEventId, userId })
    expect(
      await ratingEventsRepository.countReviewBudgetConsumedToday({ userId, targetLanguage: 'es', mode: 'recognition' })
    ).toBe(1)
  })

  test('findLatestLiveEventForUndo addresses the facet, not the term', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const term = await createKeptTerm(userId, 'gato')
    const citationEvent = await logReview({
      userId,
      userLookupId: term.id,
      skill: 'meaning_recognition',
      targetForm: '',
    })
    const formEvent = await logReview({
      userId,
      userLookupId: term.id,
      skill: 'meaning_recognition',
      targetForm: 'gatos',
    })

    const citation = await ratingEventsRepository.findLatestLiveEventForUndo({
      userId,
      userLookupId: term.id,
      skill: 'meaning_recognition',
      targetForm: '',
    })
    const form = await ratingEventsRepository.findLatestLiveEventForUndo({
      userId,
      userLookupId: term.id,
      skill: 'meaning_recognition',
      targetForm: 'gatos',
    })
    expect(citation?.id).toBe(citationEvent)
    expect(form?.id).toBe(formEvent)
  })

  test('sibling spacing keeps a term’s two facets non-adjacent when a separator exists', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const due = '2026-06-01T00:00:00Z'
    for (const hw of ['alfa', 'beta']) {
      const term = await createKeptTerm(userId, hw)
      await studyFacetsRepository.ensureCitationFacet(term.id)
      await sql`UPDATE public.study_facets SET srs_state = 'review', srs_due = ${due} WHERE user_lookup_id = ${term.id} AND target_form = ''`
      await insertFacet({
        userLookupId: term.id,
        userId,
        skill: 'meaning_recognition',
        targetForm: hw + 's',
        srsState: 'review',
        srsDue: due,
      })
    }

    const rows = await userLookupsRepository.listReviewTerms({
      userId,
      targetLanguage: 'es',
      pool: 'passive',
      scope: 'review_due',
      maxReviewTerms: 100,
      maxLearningTerms: 100,
      maxNewTerms: 0,
      maxOptInNewTerms: 0,
    })
    expect(rows).toHaveLength(4)
    // No two consecutive rows share a term (separators are available).
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.id).not.toBe(rows[i - 1]!.id)
  })

  test('one term with two due facets degrades gracefully (tail adjacency, no crash)', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const term = await createKeptTerm(userId, 'solo')
    const due = '2026-06-01T00:00:00Z'
    await studyFacetsRepository.ensureCitationFacet(term.id)
    await sql`UPDATE public.study_facets SET srs_state = 'review', srs_due = ${due} WHERE user_lookup_id = ${term.id} AND target_form = ''`
    await insertFacet({
      userLookupId: term.id,
      userId,
      skill: 'meaning_recognition',
      targetForm: 'solos',
      srsState: 'review',
      srsDue: due,
    })

    const rows = await userLookupsRepository.listReviewTerms({
      userId,
      targetLanguage: 'es',
      pool: 'passive',
      scope: 'review_due',
      maxReviewTerms: 100,
      maxLearningTerms: 100,
      maxNewTerms: 0,
      maxOptInNewTerms: 0,
    })
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.id === term.id)).toBe(true)
  })

  test('opt-in new facet is served in learn_new but never in mixed', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const term = await createKeptTerm(userId, 'nuevo')
    await studyFacetsRepository.ensureCitationFacet(term.id) // citation recognition, state NULL (new)
    await insertFacet({
      userLookupId: term.id,
      userId,
      skill: 'meaning_recognition',
      targetForm: 'nuevos',
      srsState: null,
      srsDue: null,
    })

    const baseParams = {
      userId,
      targetLanguage: 'es',
      pool: 'passive' as const,
      maxReviewTerms: 0,
      maxLearningTerms: 0,
      maxNewTerms: 50,
    }
    // mixed: opt-in cap 0 -> only the citation new card.
    const mixed = await userLookupsRepository.listReviewTerms({ ...baseParams, scope: 'mixed', maxOptInNewTerms: 0 })
    expect(mixed.map((r) => r.target_form).sort()).toEqual([''])

    // learn_new: opt-in cap > 0 -> both the citation and the form new card.
    const learn = await userLookupsRepository.listReviewTerms({
      ...baseParams,
      scope: 'learn_new',
      maxOptInNewTerms: 50,
    })
    expect(learn.map((r) => r.target_form).sort()).toEqual(['', 'nuevos'])
  })

  // Phase 4a: pronunciation is a recognition-mode (passive) facet. A ready,
  // enabled, due pronunciation facet is served in the passive queue alongside
  // the citation meaning facet; a disabled or pending_data one is filtered out.
  test('pronunciation facet is served in the passive queue (ready+enabled only)', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const due = '2026-06-01T00:00:00Z'

    // Term A: citation meaning + a ready, enabled, due pronunciation facet.
    const served = await createKeptTerm(userId, 'casa')
    await studyFacetsRepository.ensureCitationFacet(served.id)
    await sql`UPDATE public.study_facets SET srs_state = 'review', srs_due = ${due} WHERE user_lookup_id = ${served.id} AND target_form = ''`
    await insertFacet({
      userLookupId: served.id,
      userId,
      skill: 'pronunciation',
      targetForm: '',
      srsState: 'review',
      srsDue: due,
    })

    // Term B: a disabled pronunciation facet — must NOT appear.
    const disabled = await createKeptTerm(userId, 'perro')
    await studyFacetsRepository.ensureCitationFacet(disabled.id)
    await insertFacet({
      userLookupId: disabled.id,
      userId,
      skill: 'pronunciation',
      targetForm: '',
      srsState: 'review',
      srsDue: due,
      disabledAt: due,
    })

    const rows = await userLookupsRepository.listReviewTerms({
      userId,
      targetLanguage: 'es',
      pool: 'passive',
      scope: 'review_due',
      maxReviewTerms: 100,
      maxLearningTerms: 100,
      maxNewTerms: 0,
      maxOptInNewTerms: 0,
    })

    // The served term's pronunciation facet is present; the disabled one's is not.
    const pronRows = rows.filter((r) => r.skill === 'pronunciation')
    expect(pronRows).toHaveLength(1)
    expect(pronRows[0]!.id).toBe(served.id)
    // It sits next to (spaced from) the citation meaning facet of the same term.
    expect(
      rows
        .filter((r) => r.id === served.id)
        .map((r) => r.skill)
        .sort()
    ).toEqual(['meaning_recognition', 'pronunciation'])
    expect(rows.some((r) => r.id === disabled.id && r.skill === 'pronunciation')).toBe(false)
  })

  test('production queue never serves a pronunciation facet', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const due = '2026-06-01T00:00:00Z'
    const term = await createKeptTerm(userId, 'libro')
    await insertFacet({
      userLookupId: term.id,
      userId,
      skill: 'pronunciation',
      targetForm: '',
      srsState: 'review',
      srsDue: due,
    })

    const active = await userLookupsRepository.listReviewTerms({
      userId,
      targetLanguage: 'es',
      pool: 'active',
      scope: 'review_due',
      maxReviewTerms: 100,
      maxLearningTerms: 100,
      maxNewTerms: 0,
      maxOptInNewTerms: 0,
    })
    expect(active.some((r) => r.skill === 'pronunciation')).toBe(false)
  })
})
