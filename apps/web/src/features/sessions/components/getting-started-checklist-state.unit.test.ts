import { describe, expect, it } from 'vitest'
import { shouldHideGettingStartedChecklist } from './getting-started-checklist-state'

const visibleState = {
  retired: false,
  flagsResolved: true,
  statusResolved: true,
  allDone: false,
  mutationPending: false,
  mutationSucceeded: false,
}

describe('shouldHideGettingStartedChecklist', () => {
  it('keeps unresolved and retired checklists out of the page', () => {
    expect(shouldHideGettingStartedChecklist({ ...visibleState, flagsResolved: false })).toBe(true)
    expect(shouldHideGettingStartedChecklist({ ...visibleState, statusResolved: false })).toBe(true)
    expect(shouldHideGettingStartedChecklist({ ...visibleState, retired: true })).toBe(true)
  })

  it('hides all-done state before the completion effect can paint it', () => {
    expect(shouldHideGettingStartedChecklist({ ...visibleState, allDone: true })).toBe(true)
  })

  it('shows an incomplete, fully resolved checklist', () => {
    expect(shouldHideGettingStartedChecklist(visibleState)).toBe(false)
  })
})
