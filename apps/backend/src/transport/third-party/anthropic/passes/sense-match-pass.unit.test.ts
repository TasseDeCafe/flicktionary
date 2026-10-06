import { describe, expect, it } from 'vitest'
import { parseSenseMatchPassText, type SenseMatchExisting } from './sense-match-pass'

const existing: SenseMatchExisting[] = [
  { userLookupId: 'a', sense: 'revolt, uprising', definition: null, translation: 'uprising' },
  { userLookupId: 'b', sense: 'rebellion (formal)', definition: null, translation: null },
]

describe('parseSenseMatchPassText', () => {
  it('maps a sense number to its lookup id', () => {
    expect(parseSenseMatchPassText('2', existing)).toBe('b')
    expect(parseSenseMatchPassText('  1.\n', existing)).toBe('a')
  })

  it('treats "new" as no match', () => {
    expect(parseSenseMatchPassText('new', existing)).toBeNull()
    expect(parseSenseMatchPassText('NEW', existing)).toBeNull()
  })

  it('never guesses on an out-of-range or unparseable answer', () => {
    expect(parseSenseMatchPassText('3', existing)).toBeNull()
    expect(parseSenseMatchPassText('0', existing)).toBeNull()
    expect(parseSenseMatchPassText('Sense 1 matches', existing)).toBeNull()
    expect(parseSenseMatchPassText('', existing)).toBeNull()
  })
})
