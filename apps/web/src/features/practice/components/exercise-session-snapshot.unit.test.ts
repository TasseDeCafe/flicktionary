import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  Chunk,
  StrengthenExerciseEntry,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import type { ExerciseAnswerData } from './strengthen-types'
import { currentDayKey } from './composed-session-snapshot'
import {
  clearExerciseSession,
  dropTermFromExerciseSession,
  exerciseSessionKey,
  patchTermInExerciseSession,
  saveExerciseSession,
  takeExerciseSession,
  type ExerciseSessionSnapshot,
} from './exercise-session-snapshot'

const entry = (userLookupId: string): StrengthenExerciseEntry => ({ userLookupId }) as StrengthenExerciseEntry

const key = exerciseSessionKey({ mode: 'strengthen', targetLanguage: 'en', pool: 'recognition' })

const snapshot = (over: Partial<ExerciseSessionSnapshot> = {}): ExerciseSessionSnapshot => ({
  key,
  queue: [entry('u1'), entry('u2')],
  index: 0,
  correctCount: 0,
  currentOutcome: null,
  dailyLimitReached: false,
  dayKey: currentDayKey(),
  ...over,
})

afterEach(() => {
  clearExerciseSession()
  vi.useRealTimers()
})

describe('exerciseSessionKey', () => {
  it('treats sessionHard as an unordered set and distinguishes every scope part', () => {
    const base = { mode: 'strengthen' as const, targetLanguage: 'en', pool: 'recognition', mix: ['en', 'pt'] }
    expect(exerciseSessionKey({ ...base, sessionHard: ['a', 'b'] })).toBe(
      exerciseSessionKey({ ...base, sessionHard: ['b', 'a'] })
    )
    expect(exerciseSessionKey(base)).not.toBe(exerciseSessionKey({ ...base, pool: 'production' }))
    expect(exerciseSessionKey(base)).not.toBe(exerciseSessionKey({ ...base, mix: ['en'] }))
    expect(exerciseSessionKey(base)).not.toBe(exerciseSessionKey({ ...base, mode: 'warmup' }))
  })
})

describe('takeExerciseSession', () => {
  it('resumes a matching same-day snapshot exactly once', () => {
    const saved = snapshot()
    saveExerciseSession(saved)
    expect(takeExerciseSession(key)).toBe(saved)
    // Consumed on read — a second entry starts fresh.
    expect(takeExerciseSession(key)).toBeNull()
  })

  it('discards a snapshot for another session scope', () => {
    saveExerciseSession(snapshot())
    expect(takeExerciseSession(exerciseSessionKey({ mode: 'warmup', targetLanguage: 'en' }))).toBeNull()
    // Discarded, not kept for a later matching entry.
    expect(takeExerciseSession(key)).toBeNull()
  })

  it('never resumes across a day boundary', () => {
    saveExerciseSession(snapshot())
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.now() + 24 * 60 * 60 * 1000))
    expect(takeExerciseSession(key)).toBeNull()
  })
})

describe('dropTermFromExerciseSession', () => {
  it('removes the deleted term at and after the live index, keeping passed entries', () => {
    saveExerciseSession(
      snapshot({
        queue: [entry('victim'), entry('other'), entry('victim'), entry('victim')],
        index: 1,
      })
    )

    dropTermFromExerciseSession('victim')

    const resumed = takeExerciseSession(key)
    // The passed copy stays (removing it would shift the live index onto the
    // wrong entry); everything at/after the index is gone.
    expect(resumed?.queue.map((e) => e.userLookupId)).toEqual(['victim', 'other'])
    expect(resumed?.index).toBe(1)
  })

  it('clears the stashed outcome when the answered current entry is the deleted term', () => {
    saveExerciseSession(
      snapshot({
        queue: [entry('victim'), entry('other')],
        index: 0,
        currentOutcome: { correct: true } as ExerciseAnswerData,
      })
    )

    dropTermFromExerciseSession('victim')

    const resumed = takeExerciseSession(key)
    expect(resumed?.queue.map((e) => e.userLookupId)).toEqual(['other'])
    expect(resumed?.currentOutcome).toBeNull()
  })

  it('removes a correctly answered current entry from the correct tally with it', () => {
    // Without the decrement the completion screen could read "2 of 1 correct":
    // the entry leaves the total but its answer would stay counted.
    saveExerciseSession(
      snapshot({
        queue: [entry('other'), entry('victim')],
        index: 1,
        correctCount: 2,
        currentOutcome: { correct: true } as ExerciseAnswerData,
      })
    )

    dropTermFromExerciseSession('victim')

    const resumed = takeExerciseSession(key)
    expect(resumed?.queue.map((e) => e.userLookupId)).toEqual(['other'])
    expect(resumed?.correctCount).toBe(1)
  })

  it('keeps the tally when the deleted current entry was answered incorrectly', () => {
    saveExerciseSession(
      snapshot({
        queue: [entry('other'), entry('victim')],
        index: 1,
        correctCount: 1,
        currentOutcome: { correct: false } as ExerciseAnswerData,
      })
    )

    dropTermFromExerciseSession('victim')

    const resumed = takeExerciseSession(key)
    expect(resumed?.correctCount).toBe(1)
    expect(resumed?.currentOutcome).toBeNull()
  })

  it('keeps the outcome when another term is deleted', () => {
    const outcome = { correct: false } as ExerciseAnswerData
    saveExerciseSession(
      snapshot({
        queue: [entry('current'), entry('victim')],
        index: 0,
        currentOutcome: outcome,
      })
    )

    dropTermFromExerciseSession('victim')

    const resumed = takeExerciseSession(key)
    expect(resumed?.queue.map((e) => e.userLookupId)).toEqual(['current'])
    expect(resumed?.currentOutcome).toBe(outcome)
  })

  it('is a no-op when nothing is stashed', () => {
    dropTermFromExerciseSession('victim')
    expect(takeExerciseSession(key)).toBeNull()
  })
})

describe('patchTermInExerciseSession', () => {
  const editedChunk = {
    id: 'edited',
    headword: 'new headword',
    sense: 'new sense',
    translation: 'new translation',
    definition: 'new definition',
  } as Chunk

  it('rewrites every stashed entry of the edited term, leaving others untouched', () => {
    const other = { userLookupId: 'other', headword: 'untouched' } as StrengthenExerciseEntry
    saveExerciseSession(snapshot({ queue: [entry('edited'), other, entry('edited')] }))

    patchTermInExerciseSession(editedChunk)

    const resumed = takeExerciseSession(key)
    const patched = { headword: 'new headword', sense: 'new sense', translation: 'new translation' }
    expect(resumed?.queue[0]).toMatchObject(patched)
    expect(resumed?.queue[2]).toMatchObject(patched)
    expect(resumed?.queue[1]?.headword).toBe('untouched')
  })

  it('is a no-op when nothing is stashed', () => {
    expect(() => patchTermInExerciseSession(editedChunk)).not.toThrow()
  })
})
