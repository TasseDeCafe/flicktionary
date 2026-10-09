import { describe, expect, test } from 'vitest'
import type { CaptureFacetStatus, CaptureTermStatus } from '@flicktionary/api-client/orpc-contracts/vocab-chat-contract'
import { deriveCaptureRowState } from './capture-row-state'

const facet = (overrides: Partial<CaptureFacetStatus>): CaptureFacetStatus => ({
  skill: 'meaning_production',
  targetForm: '',
  srsState: 'review',
  dueInDays: 23,
  enabled: true,
  hasHistory: true,
  parked: false,
  dataReady: true,
  boostActive: false,
  boostable: true,
  boostUndoable: false,
  boostPrevDue: null,
  ...overrides,
})

const started = (facets: CaptureFacetStatus[]): CaptureTermStatus => ({ notStarted: false, facets, demand: null })
const recognition = facet({ skill: 'meaning_recognition', dueInDays: 40 })

describe('deriveCaptureRowState', () => {
  test('a not-started term shows its capture demand', () => {
    const notStarted = (demand: CaptureTermStatus['demand']): CaptureTermStatus => ({
      notStarted: true,
      facets: [],
      demand,
    })
    expect(deriveCaptureRowState(notStarted(null), 'meaning_production')).toEqual({
      kind: 'not_started',
      demand: 'none',
      undoable: false,
    })
    expect(
      deriveCaptureRowState(notStarted({ counted: true, reverted: false, undoable: true }), 'meaning_production')
    ).toEqual({ kind: 'not_started', demand: 'moved_up', undoable: true })
    expect(
      deriveCaptureRowState(notStarted({ counted: true, reverted: true, undoable: false }), 'meaning_production')
    ).toEqual({ kind: 'not_started', demand: 'undone', undoable: false })
    // Collapsed: nothing changed, so nothing to show or undo.
    expect(
      deriveCaptureRowState(notStarted({ counted: false, reverted: false, undoable: false }), 'meaning_production')
    ).toEqual({ kind: 'not_started', demand: 'none', undoable: false })
  })

  test('the search direction picks the card', () => {
    const status = started([
      facet({ dueInDays: 23 }),
      facet({ skill: 'meaning_recognition', dueInDays: 1, boostable: false }),
    ])
    expect(deriveCaptureRowState(status, 'meaning_production')).toEqual({ kind: 'boostable', dueInDays: 23 })
    expect(deriveCaptureRowState(status, 'meaning_recognition')).toEqual({ kind: 'due', dueInDays: 1 })
  })

  test('a missing tested card is told apart from a paused one', () => {
    expect(deriveCaptureRowState(started([recognition]), 'meaning_production').kind).toBe('tested_missing')
    expect(
      deriveCaptureRowState(
        started([recognition, facet({ enabled: false, hasHistory: false, srsState: null })]),
        'meaning_production'
      ).kind
    ).toBe('tested_missing')
    expect(deriveCaptureRowState(started([recognition, facet({ enabled: false })]), 'meaning_production').kind).toBe(
      'tested_paused'
    )
  })

  test('boost, learning, rehab and not-ready states', () => {
    expect(
      deriveCaptureRowState(
        started([facet({ boostActive: true, boostable: false, dueInDays: 1, boostUndoable: true, boostPrevDue: 'x' })]),
        'meaning_production'
      )
    ).toEqual({ kind: 'boosted', undoable: true, prevDue: 'x' })
    expect(
      deriveCaptureRowState(started([facet({ srsState: 'relearning', dueInDays: 0 })]), 'meaning_production')
    ).toEqual({
      kind: 'learning',
      dueInDays: 0,
    })
    expect(deriveCaptureRowState(started([facet({ parked: true })]), 'meaning_production').kind).toBe('rehab')
    expect(deriveCaptureRowState(started([facet({ dataReady: false })]), 'meaning_production').kind).toBe('preparing')
    expect(
      deriveCaptureRowState(
        started([recognition, facet({ srsState: null, dueInDays: null, boostable: false })]),
        'meaning_production'
      ).kind
    ).toBe('tested_not_started')
  })
})
