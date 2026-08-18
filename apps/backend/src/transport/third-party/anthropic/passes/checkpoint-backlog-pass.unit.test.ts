import { describe, expect, test } from 'vitest'
import { parseCheckpointBacklogPassText, type CheckpointBacklogItem } from './checkpoint-backlog-pass'

const items: CheckpointBacklogItem[] = [
  { headword: 'переть', sense: 'push through rudely', contexts: ['…при атаке пострадали…'] },
  { headword: 'лететь', sense: 'to fly', contexts: ['620 дронов летели в сторону области.'] },
]

describe('parseCheckpointBacklogPassText', () => {
  test('maps meaning-echo verdict lines back to items', () => {
    const text = '1: при = preposition "during" -> no\n2: летели = flew (past of лететь) -> yes'
    expect(parseCheckpointBacklogPassText(text, items)).toEqual([
      { headword: 'переть', occurs: false },
      { headword: 'лететь', occurs: true },
    ])
  })

  test('accepts the "none" escape and a period separator', () => {
    const text = '1. none -> no\n2. летели = flew -> yes'
    expect(parseCheckpointBacklogPassText(text, items)).toEqual([
      { headword: 'переть', occurs: false },
      { headword: 'лететь', occurs: true },
    ])
  })

  test('missing or unparseable answers count as "does not occur"', () => {
    expect(parseCheckpointBacklogPassText('Sure!\n2: летели = flew -> yes', items)).toEqual([
      { headword: 'переть', occurs: false },
      { headword: 'лететь', occurs: true },
    ])
    expect(parseCheckpointBacklogPassText('1: no verdict arrow here', items)).toEqual([
      { headword: 'переть', occurs: false },
      { headword: 'лететь', occurs: false },
    ])
  })
})
