import { describe, expect, it, vi } from 'vitest'
import { autoKeepNeedsDataIfEligible, removeCardFromSession } from './set-card-status'

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
  const applyKeepTransition = vi.fn().mockResolvedValue(undefined)
  const applyUnkeepTransition = vi.fn().mockResolvedValue(undefined)
  return {
    updateStatus,
    applyKeepTransition,
    applyUnkeepTransition,
    deps: {
      cardsRepository: {
        findByIdForUser: vi.fn(async (id: string) => byId.get(id) ?? null),
        listBySessionId: vi.fn(async () => cards),
        updateStatus,
      } as never,
      studySessionsRepository: {
        findByIdForUser: vi.fn().mockResolvedValue({ id: sessionId }),
      } as never,
      userLookupsRepository: { applyKeepTransition, applyUnkeepTransition } as never,
    },
  }
}

describe('autoKeepNeedsDataIfEligible', () => {
  it('keeps a data-bearing needs_data card', async () => {
    const m = makeDeps([makeCard('c1', 'needs_data', { target_example: 'eat it' })])
    const result = await autoKeepNeedsDataIfEligible('c1', userId, m.deps)
    expect(result?.status).toBe('kept')
    expect(m.applyKeepTransition).toHaveBeenCalledOnce()
  })

  it('no-ops on a data-less (note-only) needs_data card', async () => {
    const m = makeDeps([makeCard('c1', 'needs_data', {})])
    const result = await autoKeepNeedsDataIfEligible('c1', userId, m.deps)
    expect(result).toBeNull()
    expect(m.updateStatus).not.toHaveBeenCalled()
    expect(m.applyKeepTransition).not.toHaveBeenCalled()
  })

  it('no-ops on an already-kept card', async () => {
    const m = makeDeps([makeCard('c1', 'kept', { definition: 'a sense' })])
    const result = await autoKeepNeedsDataIfEligible('c1', userId, m.deps)
    expect(result).toBeNull()
    expect(m.updateStatus).not.toHaveBeenCalled()
  })

  it('never resurrects a removed card', async () => {
    const m = makeDeps([makeCard('c1', 'removed', { translation: 'x' })])
    const result = await autoKeepNeedsDataIfEligible('c1', userId, m.deps)
    expect(result).toBeNull()
    expect(m.updateStatus).not.toHaveBeenCalled()
    expect(m.applyKeepTransition).not.toHaveBeenCalled()
  })
})

describe('removeCardFromSession', () => {
  it('removes a kept card and decrements its lookup count', async () => {
    const m = makeDeps([makeCard('c1', 'kept', { translation: 'x' })])
    const result = await removeCardFromSession('c1', userId, m.deps)
    expect(result?.status).toBe('removed')
    expect(m.applyUnkeepTransition).toHaveBeenCalledOnce()
    expect(m.applyKeepTransition).not.toHaveBeenCalled()
  })

  it('removes a data-less needs_data stub without touching lookup count', async () => {
    const m = makeDeps([makeCard('c1', 'needs_data', {})])
    const result = await removeCardFromSession('c1', userId, m.deps)
    expect(result?.status).toBe('removed')
    expect(m.applyUnkeepTransition).not.toHaveBeenCalled()
  })

  it('is idempotent on an already-removed card (no count change)', async () => {
    const m = makeDeps([makeCard('c1', 'removed', { translation: 'x' })])
    const result = await removeCardFromSession('c1', userId, m.deps)
    expect(result?.status).toBe('removed')
    expect(m.updateStatus).not.toHaveBeenCalled()
    expect(m.applyUnkeepTransition).not.toHaveBeenCalled()
  })

  it('returns null for an unknown card', async () => {
    const m = makeDeps([])
    const result = await removeCardFromSession('missing', userId, m.deps)
    expect(result).toBeNull()
  })
})
