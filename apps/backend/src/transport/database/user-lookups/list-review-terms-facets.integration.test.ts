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
      pool: params.skill === 'meaning_production' ? 'production' : 'recognition',
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
      prevSrsLearningSteps: 0,
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
      await ratingEventsRepository.countReviewBudgetConsumedToday({ userId, targetLanguage: 'es', pool: 'recognition' })
    ).toBe(2)

    // Reverting the form facet's event refunds its slot.
    await ratingEventsRepository.markReverted({ eventId: formEventId, userId })
    expect(
      await ratingEventsRepository.countReviewBudgetConsumedToday({ userId, targetLanguage: 'es', pool: 'recognition' })
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
      pool: 'recognition',
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
      pool: 'recognition',
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
      pool: 'recognition' as const,
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

  // Phase 4a: pronunciation is a recognition-mode (recognition) facet. A ready,
  // enabled, due pronunciation facet is served in the recognition queue alongside
  // the citation meaning facet; a disabled or pending_data one is filtered out.
  test('pronunciation facet is served in the recognition queue (ready+enabled only)', async () => {
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
      pool: 'recognition',
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

    const production = await userLookupsRepository.listReviewTerms({
      userId,
      targetLanguage: 'es',
      pool: 'production',
      scope: 'review_due',
      maxReviewTerms: 100,
      maxLearningTerms: 100,
      maxNewTerms: 0,
      maxOptInNewTerms: 0,
    })
    expect(production.some((r) => r.skill === 'pronunciation')).toBe(false)
  })

  // Production FORM facets are opt-in news in the ACTIVE pool: served by the
  // opt-in bucket in learn_new, never in mixed (Trap 22 applies to both pools).
  test('unseen production form facet is served in production learn_new, not mixed', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const term = await createKeptTerm(userId, 'hablar')
    // Citation production facet already scheduled (not new) — only the form is unseen.
    await insertFacet({
      userLookupId: term.id,
      userId,
      skill: 'meaning_production',
      targetForm: '',
      srsState: 'review',
      srsDue: '2030-01-01T00:00:00Z',
    })
    await insertFacet({
      userLookupId: term.id,
      userId,
      skill: 'meaning_production',
      targetForm: 'hablo',
      srsState: null,
      srsDue: null,
    })

    const baseParams = {
      userId,
      targetLanguage: 'es',
      pool: 'production' as const,
      maxReviewTerms: 0,
      maxLearningTerms: 0,
      maxNewTerms: 50,
    }
    const learn = await userLookupsRepository.listReviewTerms({
      ...baseParams,
      scope: 'learn_new',
      maxOptInNewTerms: 50,
    })
    expect(learn.map((r) => r.target_form)).toEqual(['hablo'])

    const mixed = await userLookupsRepository.listReviewTerms({ ...baseParams, scope: 'mixed', maxOptInNewTerms: 0 })
    expect(mixed.some((r) => r.target_form === 'hablo')).toBe(false)
  })

  // Composed-queue discovery: which terms may enter warm-up, oldest-added
  // first, mirroring warmup.ts's session-scoped eligibleToEnter.
  test('listEligibleNewCitationFacets filters to enterable terms, oldest-added first', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()

    // Eligible: enabled + never-reviewed + unparked citation facets. Created in
    // this order, so `older` must come back before `newer`.
    const older = await createKeptTerm(userId, 'older')
    await studyFacetsRepository.ensureCitationFacet(older.id)
    const newer = await createKeptTerm(userId, 'newer')
    await studyFacetsRepository.ensureCitationFacet(newer.id)

    // Ineligible for every reason the filter guards.
    const reviewed = await createKeptTerm(userId, 'reviewed')
    await studyFacetsRepository.ensureCitationFacet(reviewed.id)
    await sql`UPDATE public.study_facets SET srs_state = 'review' WHERE user_lookup_id = ${reviewed.id}`
    const parked = await createKeptTerm(userId, 'parked')
    await studyFacetsRepository.ensureCitationFacet(parked.id)
    await sql`UPDATE public.study_facets SET leech_parked_at = NOW() WHERE user_lookup_id = ${parked.id}`
    const disabled = await createKeptTerm(userId, 'disabled')
    await studyFacetsRepository.ensureCitationFacet(disabled.id)
    await sql`UPDATE public.study_facets SET disabled_at = NOW() WHERE user_lookup_id = ${disabled.id}`
    const noFacet = await createKeptTerm(userId, 'nofacet')
    const unkept = await userLookupsRepository.findOrCreate({
      userId,
      targetLanguage: 'es',
      headword: 'unkept',
      sense: 'x',
    })
    await studyFacetsRepository.ensureCitationFacet(unkept.id) // count stays 0

    const eligible = await userLookupsRepository.listEligibleNewCitationFacets({
      userId,
      targetLanguage: 'es',
      pool: 'recognition',
    })
    expect(eligible).toEqual([older.id, newer.id])
    for (const excluded of [reviewed.id, parked.id, disabled.id, noFacet.id, unkept.id]) {
      expect(eligible).not.toContain(excluded)
    }
  })

  test('listEligibleNewCitationFacets addresses the pool’s own citation facet', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const term = await createKeptTerm(userId, 'hablar')
    // Recognition facet already reviewed; production facet unseen.
    await studyFacetsRepository.ensureCitationFacet(term.id)
    await sql`UPDATE public.study_facets SET srs_state = 'review' WHERE user_lookup_id = ${term.id}`
    await insertFacet({
      userLookupId: term.id,
      userId,
      skill: 'meaning_production',
      targetForm: '',
      srsState: null,
      srsDue: null,
    })

    expect(
      await userLookupsRepository.listEligibleNewCitationFacets({ userId, targetLanguage: 'es', pool: 'recognition' })
    ).toEqual([])
    expect(
      await userLookupsRepository.listEligibleNewCitationFacets({ userId, targetLanguage: 'es', pool: 'production' })
    ).toEqual([term.id])
  })

  // The composed queue's wasted-gate guard: a term whose rehab day-credit was
  // already earned today is excluded (same CURRENT_DATE semantics as
  // advanceRehabDayFacet's IS DISTINCT FROM guard).
  test('listParkedTerms excludeCreditedToday drops terms credited today, keeps yesterday/null', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()

    const park = async (headword: string, lastCorrectOn: 'today' | 'yesterday' | null) => {
      const term = await createKeptTerm(userId, headword)
      await studyFacetsRepository.ensureCitationFacet(term.id)
      const lastCorrect =
        lastCorrectOn === 'today'
          ? sql`CURRENT_DATE`
          : lastCorrectOn === 'yesterday'
            ? sql`CURRENT_DATE - 1`
            : sql`NULL`
      await sql`
        UPDATE public.study_facets
        SET leech_parked_at = NOW(), leech_rehab_last_correct_on = ${lastCorrect}
        WHERE user_lookup_id = ${term.id} AND target_form = ''
      `
      return term
    }
    const creditedToday = await park('hoy', 'today')
    const creditedYesterday = await park('ayer', 'yesterday')
    const neverCredited = await park('nunca', null)

    const all = await userLookupsRepository.listParkedTerms({ userId, targetLanguage: 'es', pool: 'recognition' })
    expect(all.map((r) => r.id).sort()).toEqual([creditedToday.id, creditedYesterday.id, neverCredited.id].sort())

    const uncredited = await userLookupsRepository.listParkedTerms({
      userId,
      targetLanguage: 'es',
      pool: 'recognition',
      excludeCreditedToday: true,
    })
    expect(uncredited.map((r) => r.id).sort()).toEqual([creditedYesterday.id, neverCredited.id].sort())
  })

  // The landing/learn-new counts must mirror the queue's enabled-facet filter:
  // a disabled recognition facet is invisible to listReviewTerms, so counting
  // it in the due summary promises cards ("2 new available") that the session
  // then refuses to serve ("No new terms to learn"). Introductions performed
  // today still count toward the daily-new budget even if disabled afterwards.
  test('due summary excludes disabled recognition facets from new/due counts', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const due = '2026-06-01T00:00:00Z'

    // Enabled, unseen citation facet -> the only "new" card.
    const enabled = await createKeptTerm(userId, 'uno')
    await studyFacetsRepository.ensureCitationFacet(enabled.id)

    // Disabled, unseen citation facet introduced today -> excluded from
    // newCount, still counted as introduced today.
    const disabledNew = await createKeptTerm(userId, 'dos')
    await studyFacetsRepository.ensureCitationFacet(disabledNew.id)
    await sql`
      UPDATE public.study_facets
      SET disabled_at = NOW(), introduced_at = NOW()
      WHERE user_lookup_id = ${disabledNew.id} AND target_form = ''
    `

    // Disabled, due citation facet -> excluded from reviewDueCount.
    const disabledDue = await createKeptTerm(userId, 'tres')
    await studyFacetsRepository.ensureCitationFacet(disabledDue.id)
    await sql`
      UPDATE public.study_facets
      SET srs_state = 'review', srs_due = ${due}, disabled_at = NOW()
      WHERE user_lookup_id = ${disabledDue.id} AND target_form = ''
    `

    const summary = (await userLookupsRepository.listDueSummary(userId)).find((s) => s.targetLanguage === 'es')
    expect(summary?.totalKept).toBe(3)
    expect(summary?.newCount).toBe(1)
    expect(summary?.reviewDueCount).toBe(0)
    expect(summary?.newIntroducedTodayCount).toBe(1)
  })

  // The opt-in counters mirror the queue's opt-in new bucket: enabled+ready
  // unseen non-citation facets (plus citation pronunciation — it IS opt-in),
  // split by review mode. Disabled and pending_data facets don't count.
  test('due summary counts unseen opt-in facets per mode', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const term = await createKeptTerm(userId, 'cantar')
    await studyFacetsRepository.ensureCitationFacet(term.id)

    // Recognition-mode opt-ins: citation pronunciation + a recognition form.
    await insertFacet({
      userLookupId: term.id,
      userId,
      skill: 'pronunciation',
      targetForm: '',
      srsState: null,
      srsDue: null,
    })
    await insertFacet({
      userLookupId: term.id,
      userId,
      skill: 'meaning_recognition',
      targetForm: 'canto',
      srsState: null,
      srsDue: null,
    })
    // Production-mode opt-in: a production form.
    await insertFacet({
      userLookupId: term.id,
      userId,
      skill: 'meaning_production',
      targetForm: 'canto',
      srsState: null,
      srsDue: null,
    })
    // Neither disabled nor pending_data opt-ins count.
    await insertFacet({
      userLookupId: term.id,
      userId,
      skill: 'meaning_recognition',
      targetForm: 'cantas',
      srsState: null,
      srsDue: null,
      disabledAt: '2026-06-01T00:00:00Z',
    })
    await insertFacet({
      userLookupId: term.id,
      userId,
      skill: 'meaning_recognition',
      targetForm: 'cantamos',
      srsState: null,
      srsDue: null,
      dataStatus: 'pending_data',
    })

    const summary = (await userLookupsRepository.listDueSummary(userId)).find((s) => s.targetLanguage === 'es')
    expect(summary?.newCount).toBe(1) // the citation recognition facet stays citation-only
    expect(summary?.optInNewCount).toBe(2)
    expect(summary?.productionOptInNewCount).toBe(1)
  })
})
