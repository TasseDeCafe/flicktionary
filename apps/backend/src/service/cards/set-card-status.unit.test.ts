import { describe, expect, it, vi } from 'vitest'
import { autoKeepPendingIfEligible, setCardStatus, setCardStatusBatch, CardKeepBlockedError } from './set-card-status'

const userId = '00000000-0000-0000-0000-000000000001'
const sessionId = '00000000-0000-0000-0000-000000000002'

const makeCard = (id: string, status: string, chunk: Partial<Record<string, unknown>>) => ({
  id,
  status,
  user_lookup_id: `ul-${id}`,
  study_session_id: sessionId,
  chunk: { translation: null, definition: null, target_example: null, ...chunk },
})

const makeDeps = (cards: ReturnType<typeof makeCard>[]) => {
  const byId = new Map(cards.map((c) => [c.id, c]))
  const updateStatus = vi.fn(async (id: string, status: string) => ({ ...byId.get(id), status }))
  const updateStatusBatch = vi.fn(async (_s: string, ids: string[], status: string) =>
    ids.map((id) => ({ ...byId.get(id), status }))
  )
  const applyKeepTransition = vi.fn().mockResolvedValue(undefined)
  const applyUnkeepTransition = vi.fn().mockResolvedValue(undefined)
  return {
    updateStatus,
    updateStatusBatch,
    applyKeepTransition,
    deps: {
      cardsRepository: {
        findByIdForUser: vi.fn(async (id: string) => byId.get(id) ?? null),
        listBySessionId: vi.fn(async () => cards),
        updateStatus,
        updateStatusBatch,
      } as never,
      studySessionsRepository: {
        findByIdForUser: vi.fn().mockResolvedValue({ id: sessionId }),
      } as never,
      userLookupsRepository: { applyKeepTransition, applyUnkeepTransition } as never,
    },
  }
}

describe('setCardStatus keep guard', () => {
  it('rejects keeping a data-less (note-only) card', async () => {
    const m = makeDeps([makeCard('c1', 'pending', {})])
    await expect(setCardStatus('c1', userId, 'kept', m.deps)).rejects.toBeInstanceOf(CardKeepBlockedError)
    expect(m.updateStatus).not.toHaveBeenCalled()
  })

  it('allows keeping a card that has basic data', async () => {
    const m = makeDeps([makeCard('c1', 'pending', { definition: 'a sense' })])
    const result = await setCardStatus('c1', userId, 'kept', m.deps)
    expect(result?.status).toBe('kept')
    expect(m.applyKeepTransition).toHaveBeenCalledOnce()
  })

  it('does not block rejecting a data-less card', async () => {
    const m = makeDeps([makeCard('c1', 'pending', {})])
    const result = await setCardStatus('c1', userId, 'rejected', m.deps)
    expect(result?.status).toBe('rejected')
  })
})

describe('autoKeepPendingIfEligible', () => {
  it('keeps a data-bearing pending card', async () => {
    const m = makeDeps([makeCard('c1', 'pending', { target_example: 'eat it' })])
    const result = await autoKeepPendingIfEligible('c1', userId, m.deps)
    expect(result?.status).toBe('kept')
    expect(m.applyKeepTransition).toHaveBeenCalledOnce()
  })

  it('no-ops on a data-less (note-only) pending card', async () => {
    const m = makeDeps([makeCard('c1', 'pending', {})])
    const result = await autoKeepPendingIfEligible('c1', userId, m.deps)
    expect(result).toBeNull()
    expect(m.updateStatus).not.toHaveBeenCalled()
    expect(m.applyKeepTransition).not.toHaveBeenCalled()
  })

  it('no-ops on an already-kept card', async () => {
    const m = makeDeps([makeCard('c1', 'kept', { definition: 'a sense' })])
    const result = await autoKeepPendingIfEligible('c1', userId, m.deps)
    expect(result).toBeNull()
    expect(m.updateStatus).not.toHaveBeenCalled()
  })

  it('never resurrects a removed (rejected) card', async () => {
    const m = makeDeps([makeCard('c1', 'rejected', { translation: 'x' })])
    const result = await autoKeepPendingIfEligible('c1', userId, m.deps)
    expect(result).toBeNull()
    expect(m.updateStatus).not.toHaveBeenCalled()
    expect(m.applyKeepTransition).not.toHaveBeenCalled()
  })

  it('never resurrects an auto_rejected card', async () => {
    const m = makeDeps([makeCard('c1', 'auto_rejected', { translation: 'x' })])
    const result = await autoKeepPendingIfEligible('c1', userId, m.deps)
    expect(result).toBeNull()
    expect(m.updateStatus).not.toHaveBeenCalled()
  })
})

describe('setCardStatusBatch keep guard', () => {
  it('skips data-less cards on "Keep all" but keeps the data-bearing ones', async () => {
    const m = makeDeps([makeCard('with-data', 'pending', { translation: 'x' }), makeCard('no-data', 'pending', {})])
    await setCardStatusBatch(sessionId, ['with-data', 'no-data'], userId, 'kept', m.deps)
    expect(m.updateStatusBatch).toHaveBeenCalledOnce()
    const [, ids] = m.updateStatusBatch.mock.calls[0]
    expect(ids).toEqual(['with-data'])
  })

  it('does not filter on a reject-all batch', async () => {
    const m = makeDeps([makeCard('a', 'pending', {}), makeCard('b', 'pending', {})])
    await setCardStatusBatch(sessionId, ['a', 'b'], userId, 'rejected', m.deps)
    const [, ids] = m.updateStatusBatch.mock.calls[0]
    expect(ids).toEqual(['a', 'b'])
  })
})
