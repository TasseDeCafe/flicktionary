import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbPracticeRatingEvent } from '../../transport/database/practice-rating-events/practice-rating-events-repository'
import type { DbUserLookup } from '../../transport/database/user-lookups/user-lookups-repository'
import { undoRating, type UndoRatingDependencies } from './undo-rating'

const userId = '00000000-0000-0000-0000-000000000001'
const lookupId = '00000000-0000-0000-0000-000000000004'
const eventId = '00000000-0000-0000-0000-00000000000e'

const makeLookup = (overrides: Partial<DbUserLookup> = {}): DbUserLookup =>
  ({
    id: lookupId,
    user_id: userId,
    target_language: 'es',
    headword: 'gato',
    sense: 'cat',
    learning_mode: 'passive',
    deleted_at: null,
    ...overrides,
  }) as DbUserLookup

const makeEvent = (overrides: Partial<DbPracticeRatingEvent> = {}): DbPracticeRatingEvent =>
  ({
    id: eventId,
    user_id: userId,
    user_lookup_id: lookupId,
    target_language: 'es',
    pool: 'passive',
    rating: 'good',
    was_explicit: true,
    was_introduction: false,
    caused_parking: false,
    practice_text_id: null,
    headword: 'gato',
    sense: 'cat',
    prev_srs_state: 'review',
    prev_srs_due: '2026-05-12T00:00:00Z',
    prev_srs_stability: 5,
    prev_srs_difficulty: 6,
    prev_srs_last_review: '2026-05-01T00:00:00Z',
    prev_srs_reps: 8,
    prev_srs_lapses: 1,
    rated_at: '2026-06-07T00:00:00Z',
    reverted_at: null,
    ...overrides,
  }) as DbPracticeRatingEvent

const createDeps = (params: { lookup: DbUserLookup | null; latestEvent: DbPracticeRatingEvent | null }) => {
  const findLatestLiveEventForUndo = vi.fn().mockResolvedValue(params.latestEvent)
  const markReverted = vi.fn().mockResolvedValue(undefined)
  const restoreSrsSnapshotForFacet = vi.fn().mockResolvedValue(undefined)
  const txCallbacks: unknown[] = []
  const deps = {
    userLookupsRepository: {
      findByIdForUser: vi.fn().mockResolvedValue(params.lookup),
    },
    studyFacetsRepository: {
      restoreSrsSnapshotForFacet,
    },
    practiceRatingEventsRepository: {
      findLatestLiveEventForUndo,
      markReverted,
    },
    // Unit fake: run the callback with no real executor — repo mocks ignore it.
    withTransaction: (fn: (tx: undefined) => Promise<unknown>) => {
      txCallbacks.push(fn)
      return fn(undefined)
    },
  } as unknown as UndoRatingDependencies
  return { deps, findLatestLiveEventForUndo, markReverted, restoreSrsSnapshotForFacet, txCallbacks }
}

describe('undoRating', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('restores a recognition review snapshot and tombstones the event', async () => {
    const { deps, restoreSrsSnapshotForFacet, markReverted } = createDeps({
      lookup: makeLookup(),
      latestEvent: makeEvent(),
    })
    const result = await undoRating(lookupId, userId, 'passive', eventId, deps)
    expect(result).toEqual({ ok: true, undone: true })
    expect(restoreSrsSnapshotForFacet).toHaveBeenCalledWith(
      {
        userLookupId: lookupId,
        skill: 'meaning_recognition',
        targetForm: '',
        prevState: 'review',
        prevDue: '2026-05-12T00:00:00Z',
        prevStability: 5,
        prevDifficulty: 6,
        prevLastReview: '2026-05-01T00:00:00Z',
        prevReps: 8,
        prevLapses: 1,
        wasIntroduction: false,
        causedParking: false,
      },
      undefined
    )
    expect(markReverted).toHaveBeenCalledWith({ eventId, userId }, undefined)
  })

  it('restores an introduction back to a null snapshot with wasIntroduction', async () => {
    const { deps, restoreSrsSnapshotForFacet } = createDeps({
      lookup: makeLookup(),
      latestEvent: makeEvent({
        was_introduction: true,
        prev_srs_state: null,
        prev_srs_due: null,
        prev_srs_stability: null,
        prev_srs_difficulty: null,
        prev_srs_last_review: null,
        prev_srs_reps: null,
        prev_srs_lapses: null,
      }),
    })
    const result = await undoRating(lookupId, userId, 'passive', eventId, deps)
    expect(result).toEqual({ ok: true, undone: true })
    expect(restoreSrsSnapshotForFacet).toHaveBeenCalledWith(
      expect.objectContaining({
        prevState: null,
        prevDue: null,
        prevReps: null,
        prevLapses: null,
        wasIntroduction: true,
      }),
      undefined
    )
  })

  it('routes active-pool undos to the production facet', async () => {
    const { deps, findLatestLiveEventForUndo, restoreSrsSnapshotForFacet } = createDeps({
      lookup: makeLookup({ learning_mode: 'active' }),
      latestEvent: makeEvent({ pool: 'active' }),
    })
    const result = await undoRating(lookupId, userId, 'active', eventId, deps)
    expect(result).toEqual({ ok: true, undone: true })
    expect(findLatestLiveEventForUndo).toHaveBeenCalledWith(
      { userId, userLookupId: lookupId, pool: 'active' },
      undefined
    )
    expect(restoreSrsSnapshotForFacet).toHaveBeenCalledWith(
      expect.objectContaining({ skill: 'meaning_production', targetForm: '' }),
      undefined
    )
  })

  it('passes causedParking through so the restore un-parks the leech', async () => {
    const { deps, restoreSrsSnapshotForFacet } = createDeps({
      lookup: makeLookup(),
      latestEvent: makeEvent({ caused_parking: true }),
    })
    const result = await undoRating(lookupId, userId, 'passive', eventId, deps)
    expect(result).toEqual({ ok: true, undone: true })
    expect(restoreSrsSnapshotForFacet).toHaveBeenCalledWith(expect.objectContaining({ causedParking: true }), undefined)
  })

  it('refuses a stale eventId (a later rating is now the latest live event)', async () => {
    const laterEventId = '00000000-0000-0000-0000-00000000000f'
    const { deps, restoreSrsSnapshotForFacet, markReverted } = createDeps({
      lookup: makeLookup(),
      latestEvent: makeEvent({ id: laterEventId, rated_at: '2026-06-07T01:00:00Z' }),
    })
    const result = await undoRating(lookupId, userId, 'passive', eventId, deps)
    expect(result).toEqual({ ok: true, undone: false })
    expect(restoreSrsSnapshotForFacet).not.toHaveBeenCalled()
    expect(markReverted).not.toHaveBeenCalled()
  })

  it('no-ops when no live event exists (already reverted or never rated)', async () => {
    const { deps, restoreSrsSnapshotForFacet, markReverted } = createDeps({
      lookup: makeLookup(),
      latestEvent: null,
    })
    const result = await undoRating(lookupId, userId, 'passive', eventId, deps)
    expect(result).toEqual({ ok: true, undone: false })
    expect(restoreSrsSnapshotForFacet).not.toHaveBeenCalled()
    expect(markReverted).not.toHaveBeenCalled()
  })

  it('returns lookup_not_found when the term is missing', async () => {
    const { deps, findLatestLiveEventForUndo } = createDeps({ lookup: null, latestEvent: makeEvent() })
    const result = await undoRating(lookupId, userId, 'passive', eventId, deps)
    expect(result).toEqual({ ok: false, reason: 'lookup_not_found' })
    expect(findLatestLiveEventForUndo).not.toHaveBeenCalled()
  })

  it('runs find + restore + markReverted inside the same transaction', async () => {
    const calls: string[] = []
    const event = makeEvent()
    const txSentinel = Symbol('tx') as unknown as undefined
    const deps = {
      userLookupsRepository: {
        findByIdForUser: vi.fn().mockResolvedValue(makeLookup()),
      },
      studyFacetsRepository: {
        restoreSrsSnapshotForFacet: vi.fn(async (_params: unknown, tx: unknown) => {
          calls.push(tx === txSentinel ? 'restore@tx' : 'restore')
        }),
      },
      practiceRatingEventsRepository: {
        findLatestLiveEventForUndo: vi.fn(async (_params: unknown, tx: unknown) => {
          calls.push(tx === txSentinel ? 'find@tx' : 'find')
          return event
        }),
        markReverted: vi.fn(async (_params: unknown, tx: unknown) => {
          calls.push(tx === txSentinel ? 'markReverted@tx' : 'markReverted')
        }),
      },
      withTransaction: (fn: (tx: undefined) => Promise<unknown>) => fn(txSentinel),
    } as unknown as UndoRatingDependencies
    const result = await undoRating(lookupId, userId, 'passive', eventId, deps)
    expect(result).toEqual({ ok: true, undone: true })
    expect(calls).toEqual(['find@tx', 'restore@tx', 'markReverted@tx'])
  })
})
