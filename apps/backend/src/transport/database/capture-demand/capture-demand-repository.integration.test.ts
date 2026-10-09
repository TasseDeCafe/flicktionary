import { describe, expect, test } from 'vitest'
import { CaptureDemandRepository } from './capture-demand-repository'
import { StudyFacetsRepository } from '../study-facets/study-facets-repository'
import { UserLookupsRepository } from '../user-lookups/user-lookups-repository'
import { sql } from '../postgres-client'
import { __createUserInSupabaseAndGetHisIdAndToken } from '../../../test/test-utils'

// Capture demand: a search for a saved, never-started term moves it up the new
// words, visibly and undoably.
describe('capture-demand-repository', () => {
  const repo = CaptureDemandRepository()
  const userLookupsRepository = UserLookupsRepository()
  const studyFacetsRepository = StudyFacetsRepository()

  // A kept, never-started term whose last demand was two days ago (outside
  // recordEncounter's one-hour collapse window).
  const notStartedTerm = async (userId: string, headword: string) => {
    const lookup = await userLookupsRepository.findOrCreate({ userId, targetLanguage: 'es', headword, sense: 'x' })
    await sql`
      UPDATE public.user_lookups
      SET count = 1, last_demand_at = NOW() - INTERVAL '2 days', last_encountered_at = NOW() - INTERVAL '2 days',
          last_demand_attempt_at = NOW() - INTERVAL '2 days'
      WHERE id = ${lookup.id}
    `
    await studyFacetsRepository.ensureCitationFacet(lookup.id)
    return lookup.id
  }

  const signals = async (id: string) =>
    (
      (await sql`
        SELECT encounter_count, last_demand_at, last_encountered_at FROM public.user_lookups WHERE id = ${id}
      `) as Array<{ encounter_count: number; last_demand_at: Date; last_encountered_at: Date }>
    )[0]!

  test('a search counts once, shows as undoable, and its undo restores the signals exactly', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const id = await notStartedTerm(userId, 'buscar')
    const before = await signals(id)

    expect(await repo.recordCaptureDemand({ userId, userLookupId: id, source: 'search' })).toBe('counted')
    expect((await signals(id)).encounter_count).toBe(before.encounter_count + 1)
    expect((await repo.listCaptureStatus({ userId, userLookupIds: [id] })).get(id)).toMatchObject({
      notStarted: true,
      demand: { counted: true, reverted: false, undoable: true },
    })

    // A remount refires nothing, and Edit card within the hour adds nothing.
    expect(await repo.recordCaptureDemand({ userId, userLookupId: id, source: 'search' })).toBe('skipped')
    expect(await repo.recordCaptureDemand({ userId, userLookupId: id, source: 'edit_card' })).toBe('skipped')

    expect(await repo.undoCaptureDemand({ userId, userLookupId: id })).toBe(true)
    expect(await signals(id)).toEqual(before)
    expect((await repo.listCaptureStatus({ userId, userLookupIds: [id] })).get(id)?.demand).toEqual({
      counted: true,
      reverted: true,
      undoable: false,
    })
    // The undo sticks: a remount doesn't count it again.
    expect(await repo.recordCaptureDemand({ userId, userLookupId: id, source: 'search' })).toBe('skipped')

    // Move up is the explicit re-do: it counts despite the collapse window.
    expect(await repo.recordCaptureDemand({ userId, userLookupId: id, source: 'move_up' })).toBe('counted')
    expect((await signals(id)).encounter_count).toBe(before.encounter_count + 1)
    expect(await repo.recordCaptureDemand({ userId, userLookupId: id, source: 'move_up' })).toBe('skipped')
  })

  test('demand already recorded within the hour makes a search count nothing (and offer no undo)', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const id = await notStartedTerm(userId, 'colapso')
    await userLookupsRepository.recordEncounter([id])
    const before = await signals(id)

    expect(await repo.recordCaptureDemand({ userId, userLookupId: id, source: 'search' })).toBe('not_counted')
    expect(await signals(id)).toEqual(before)
    expect((await repo.listCaptureStatus({ userId, userLookupIds: [id] })).get(id)?.demand).toEqual({
      counted: false,
      reverted: false,
      undoable: false,
    })
    expect(await repo.undoCaptureDemand({ userId, userLookupId: id })).toBe(false)
  })

  // A lookup right after the search is collapsed by recordEncounter, so it
  // left no trace in encounter_count; undoing the search would erase it.
  test('later demand, even collapsed, blocks the undo', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const id = await notStartedTerm(userId, 'despues')
    await repo.recordCaptureDemand({ userId, userLookupId: id, source: 'search' })
    // Step the event back so the later demand lands at a later NOW().
    await sql`
      UPDATE public.capture_demand_events SET created_at = created_at - INTERVAL '1 minute' WHERE user_lookup_id = ${id}
    `
    await sql`
      UPDATE public.user_lookups
      SET last_demand_at = last_demand_at - INTERVAL '1 minute',
          last_encountered_at = last_encountered_at - INTERVAL '1 minute',
          last_demand_attempt_at = last_demand_attempt_at - INTERVAL '1 minute'
      WHERE id = ${id}
    `
    const counted = await signals(id)
    await userLookupsRepository.recordEncounter([id])
    expect(await signals(id)).toEqual(counted)

    expect((await repo.listCaptureStatus({ userId, userLookupIds: [id] })).get(id)?.demand?.undoable).toBe(false)
    expect(await repo.undoCaptureDemand({ userId, userLookupId: id })).toBe(false)
    expect(await signals(id)).toEqual(counted)
  })

  test('only kept, never-started terms are eligible', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const started = await notStartedTerm(userId, 'empezado')
    await sql`UPDATE public.study_facets SET srs_state = 'review', srs_due = NOW() + INTERVAL '5 days' WHERE user_lookup_id = ${started}`
    const warmingUp = await notStartedTerm(userId, 'calentando')
    await sql`UPDATE public.study_facets SET introduced_at = NOW(), leech_parked_at = NOW() WHERE user_lookup_id = ${warmingUp}`
    const unkept = await notStartedTerm(userId, 'suelto')
    await sql`UPDATE public.user_lookups SET count = 0 WHERE id = ${unkept}`
    const { id: otherUserId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const foreign = await notStartedTerm(otherUserId, 'ajeno')

    for (const id of [started, warmingUp, unkept, foreign]) {
      expect(await repo.recordCaptureDemand({ userId, userLookupId: id, source: 'search' })).toBe('not_eligible')
    }
    expect((await repo.listCaptureStatus({ userId, userLookupIds: [started] })).get(started)?.notStarted).toBe(false)
  })

  test('status lists every card with its due day and boost eligibility', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const id = await notStartedTerm(userId, 'tarjetas')
    await sql`
      UPDATE public.study_facets
      SET srs_state = 'review', srs_due = (CURRENT_DATE + 23)::timestamptz + INTERVAL '10 hours',
          srs_last_review = NOW() - INTERVAL '5 days'
      WHERE user_lookup_id = ${id}
    `
    await studyFacetsRepository.ensureFacet({ userLookupId: id, skill: 'meaning_production', targetForm: '' })
    await sql`UPDATE public.study_facets SET disabled_at = NOW() WHERE user_lookup_id = ${id} AND skill = 'meaning_production'`

    const status = (await repo.listCaptureStatus({ userId, userLookupIds: [id] })).get(id)!
    expect(status.notStarted).toBe(false)
    expect(status.demand).toBeNull()
    expect(status.facets).toEqual([
      expect.objectContaining({
        skill: 'meaning_production',
        srsState: null,
        dueInDays: null,
        enabled: false,
        hasHistory: false,
        boostable: false,
      }),
      expect.objectContaining({
        skill: 'meaning_recognition',
        srsState: 'review',
        dueInDays: 23,
        enabled: true,
        hasHistory: true,
        boostActive: false,
        boostable: true,
      }),
    ])

    await studyFacetsRepository.boostFacet({ userId, userLookupId: id, skill: 'meaning_recognition' })
    const boosted = (await repo.listCaptureStatus({ userId, userLookupIds: [id] })).get(id)!
    expect(boosted.facets[1]).toMatchObject({ dueInDays: 1, boostActive: true, boostable: false, boostUndoable: true })
    expect(boosted.facets[1]!.boostPrevDue).not.toBeNull()
  })
})
