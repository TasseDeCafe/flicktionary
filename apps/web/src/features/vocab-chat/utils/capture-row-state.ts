import type { CaptureFacetStatus, CaptureTermStatus } from '@flicktionary/api-client/orpc-contracts/vocab-chat-contract'

export type TestedSkill = 'meaning_recognition' | 'meaning_production'

// What a matched capture row shows. A search tests one card (production for a
// native-language query, recognition otherwise) and the row speaks only about
// that card; a never-started term is about the term as a whole (its demand).
export type CaptureRowState =
  // Never started. moved_up: this search (or an opened card) moved it up the
  // new words; undone: the learner undid that (Move up offered again).
  | { kind: 'not_started'; demand: 'moved_up' | 'undone' | 'none'; undoable: boolean }
  // The tested card doesn't exist, or was disabled before it ever ran.
  | { kind: 'tested_missing' }
  // The tested card was disabled with a schedule of its own.
  | { kind: 'tested_paused' }
  // The tested card is on but not introduced yet (the term's other cards are).
  | { kind: 'tested_not_started' }
  | { kind: 'rehab' }
  | { kind: 'preparing' }
  | { kind: 'boosted'; undoable: boolean; prevDue: string | null }
  | { kind: 'learning'; dueInDays: number | null }
  | { kind: 'boostable'; dueInDays: number }
  | { kind: 'due'; dueInDays: number | null }

export const testedFacet = (status: CaptureTermStatus, testedSkill: TestedSkill): CaptureFacetStatus | undefined =>
  status.facets.find((facet) => facet.skill === testedSkill && facet.targetForm === '')

export const deriveCaptureRowState = (status: CaptureTermStatus, testedSkill: TestedSkill): CaptureRowState => {
  if (status.notStarted) {
    const demand = status.demand
    if (demand?.counted && !demand.reverted)
      return { kind: 'not_started', demand: 'moved_up', undoable: demand.undoable }
    if (demand?.reverted) return { kind: 'not_started', demand: 'undone', undoable: false }
    return { kind: 'not_started', demand: 'none', undoable: false }
  }

  const facet = testedFacet(status, testedSkill)
  if (!facet || (!facet.enabled && !facet.hasHistory)) return { kind: 'tested_missing' }
  if (!facet.enabled) return { kind: 'tested_paused' }
  if (facet.parked) return { kind: 'rehab' }
  if (!facet.dataReady) return { kind: 'preparing' }
  if (facet.srsState === null) return { kind: 'tested_not_started' }
  if (facet.boostActive) return { kind: 'boosted', undoable: facet.boostUndoable, prevDue: facet.boostPrevDue }
  if (facet.srsState === 'learning' || facet.srsState === 'relearning') {
    return { kind: 'learning', dueInDays: facet.dueInDays }
  }
  if (facet.boostable && facet.dueInDays !== null) return { kind: 'boostable', dueInDays: facet.dueInDays }
  return { kind: 'due', dueInDays: facet.dueInDays }
}
