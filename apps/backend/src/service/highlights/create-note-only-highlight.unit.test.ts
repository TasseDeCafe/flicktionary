import { describe, expect, it, vi } from 'vitest'
import {
  createNoteOnlyHighlight,
  type CreateNoteOnlyHighlightDependencies,
  type WithTransaction,
} from './create-note-only-highlight'

const sessionId = '00000000-0000-0000-0000-000000000001'
const userId = '00000000-0000-0000-0000-000000000002'
const segmentId = '00000000-0000-0000-0000-000000000003'
const ghostId = '00000000-0000-0000-0000-000000000004'
const newHighlightId = '00000000-0000-0000-0000-000000000005'
const lookupId = '00000000-0000-0000-0000-000000000006'

const baseParams = {
  studySessionId: sessionId,
  startSegmentId: segmentId,
  endSegmentId: segmentId,
  startOffset: 0,
  endOffset: 4,
  selectionText: 'word',
  note: 'why this form?',
  presetTags: ['explain'],
  studyIntent: { skills: ['meaning_production'], formScope: 'form' } as Record<string, unknown>,
  fastGloss: 'gloss\nnoun\nneutral',
  chatSeedPrompt: 'Explain this.',
  userId,
  targetLanguage: 'es',
}

const makeDeps = () => {
  const insertHighlight = vi.fn().mockResolvedValue({
    id: newHighlightId,
    study_session_id: sessionId,
    start_segment_id: segmentId,
    selection_text: 'word',
  })
  const findOrCreate = vi.fn().mockResolvedValue({ id: lookupId })
  const insertCardForHighlightIdempotent = vi.fn().mockResolvedValue({ id: 'card-1' })
  const dismissGhost = vi.fn().mockResolvedValue(undefined)
  // Fake transaction: hand a sentinel executor straight to the callback.
  const tx = { __tx: true } as never
  const withTransaction = vi.fn((fn) => fn(tx)) as unknown as WithTransaction
  const deps: CreateNoteOnlyHighlightDependencies = {
    highlightsRepository: { insertHighlight } as never,
    cardsRepository: { insertCardForHighlightIdempotent } as never,
    userLookupsRepository: { findOrCreate } as never,
    ghostCandidatesRepository: { dismissGhost } as never,
    withTransaction,
  }
  return {
    tx,
    withTransaction,
    insertHighlight,
    findOrCreate,
    insertCardForHighlightIdempotent,
    dismissGhost,
    deps,
  }
}

describe('createNoteOnlyHighlight', () => {
  it('inserts the highlight + stub card in one transaction, with study_intent forced null', async () => {
    const m = makeDeps()
    const result = await createNoteOnlyHighlight(baseParams, m.deps)

    expect(result.id).toBe(newHighlightId)
    expect(m.withTransaction).toHaveBeenCalledOnce()
    // Highlight insert persists the note/tags/chat seed but NEVER the studyIntent
    // (note-only ignores skill selection) — and uses the tx executor.
    expect(m.insertHighlight).toHaveBeenCalledOnce()
    const [insertArgs, executor] = m.insertHighlight.mock.calls[0]
    expect(insertArgs).toMatchObject({
      studySessionId: sessionId,
      selectionText: 'word',
      note: 'why this form?',
      presetTags: ['explain'],
      chatSeedPrompt: 'Explain this.',
      studyIntent: null,
    })
    expect(executor).toBe(m.tx)
    // Stub card creation goes through the shared helper (findOrCreate +
    // insertCardForHighlightIdempotent), threading the same tx executor.
    expect(m.findOrCreate).toHaveBeenCalledWith({ userId, targetLanguage: 'es', headword: 'word', sense: '' }, m.tx)
    expect(m.insertCardForHighlightIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({ highlightId: newHighlightId, userLookupId: lookupId, status: 'pending' }),
      m.tx
    )
  })

  it('does not dismiss a ghost when none was adopted', async () => {
    const m = makeDeps()
    await createNoteOnlyHighlight(baseParams, m.deps)
    expect(m.dismissGhost).not.toHaveBeenCalled()
  })

  it('dismisses the adopted ghost in the same transaction', async () => {
    const m = makeDeps()
    await createNoteOnlyHighlight({ ...baseParams, adoptedGhostId: ghostId }, m.deps)
    expect(m.dismissGhost).toHaveBeenCalledWith(ghostId, sessionId, m.tx)
  })
})
